import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";
import { useLibrary } from "./useLibrary";
import { useServerActivity } from "./useServerActivity";
import { getRecentlyAddedBySection, getOnDeck } from "../services/plex-library";
import { cacheGet, cacheSet, cacheInvalidate } from "../services/api-cache";
import { groupRecentlyAdded } from "../utils/groupRecentlyAdded";
import type { PlexMediaItem, GroupedRecentItem } from "../types/library";

export interface UseDashboardResult {
  recentMovies: PlexMediaItem[];
  recentShows: GroupedRecentItem[];
  onDeck: PlexMediaItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

interface DashboardData {
  recentMovies: PlexMediaItem[];
  recentShows: GroupedRecentItem[];
  onDeck: PlexMediaItem[];
}

const CACHE_TTL = 60 * 60 * 1000; // 1 hour — long TTL so navigating back is instant
const STALE_THRESHOLD = 2 * 60 * 1000; // 2 minutes — background refetch if older than this

export function useDashboard(): UseDashboardResult {
  const { server } = useAuth();
  const { sections } = useLibrary();
  const { completionCounter } = useServerActivity();
  const cacheKey = server ? `dashboard:${server.uri}` : "";

  const [recentMovies, setRecentMovies] = useState<PlexMediaItem[]>(() => {
    const cached = cacheKey ? cacheGet<DashboardData>(cacheKey) : null;
    return cached?.recentMovies ?? [];
  });
  const [recentShows, setRecentShows] = useState<GroupedRecentItem[]>(() => {
    const cached = cacheKey ? cacheGet<DashboardData>(cacheKey) : null;
    return cached?.recentShows ?? [];
  });
  const [onDeck, setOnDeck] = useState<PlexMediaItem[]>(() => {
    const cached = cacheKey ? cacheGet<DashboardData>(cacheKey) : null;
    return cached?.onDeck ?? [];
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const hasLoadedOnce = useRef(false);
  const prevServerUri = useRef(server?.uri);

  // Reset on server switch so we show skeletons for the new server
  if (server?.uri !== prevServerUri.current) {
    prevServerUri.current = server?.uri;
    hasLoadedOnce.current = false;
  }

  const refresh = useCallback(() => {
    if (cacheKey) cacheInvalidate(cacheKey);
    setRefreshTrigger((n) => n + 1);
  }, [cacheKey]);

  // Fetch from Plex and update state + cache
  const fetchDashboard = useCallback(
    async (signal: { cancelled: boolean }, showSkeleton: boolean) => {
      if (!server || sections.length === 0) return;
      if (showSkeleton) setIsLoading(true);
      setError(null);
      try {
        const movieSections = sections.filter((s) => s.type === "movie");
        const tvSections = sections.filter((s) => s.type === "show");

        const [movieItems, tvItems, deckItems] = await Promise.all([
          getRecentlyAddedBySection(server.uri, server.accessToken, movieSections, 30),
          getRecentlyAddedBySection(server.uri, server.accessToken, tvSections, 30),
          getOnDeck(server.uri, server.accessToken),
        ]);

        if (!signal.cancelled) {
          const movies = movieItems.sort((a, b) => b.addedAt - a.addedAt);
          const shows = groupRecentlyAdded(
            tvItems.sort((a, b) => b.addedAt - a.addedAt)
          );

          setRecentMovies(movies);
          setRecentShows(shows);
          setOnDeck(deckItems);
          hasLoadedOnce.current = true;

          cacheSet(
            cacheKey,
            { recentMovies: movies, recentShows: shows, onDeck: deckItems },
            CACHE_TTL,
            true
          );
        }
      } catch (err) {
        if (!signal.cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load dashboard data"
          );
        }
      } finally {
        if (!signal.cancelled) setIsLoading(false);
      }
    },
    [server, sections, cacheKey]
  );

  useEffect(() => {
    if (!server || sections.length === 0) return;

    const cached = cacheGet<DashboardData>(cacheKey);
    const signal = { cancelled: false };

    if (cached) {
      // Always show cached data immediately
      setRecentMovies(cached.recentMovies);
      setRecentShows(cached.recentShows);
      setOnDeck(cached.onDeck);
      setIsLoading(false);
      hasLoadedOnce.current = true;

      // Always silently refresh in the background so the order is up-to-date
      // (e.g. after returning from the player, continue watching order changes)
      fetchDashboard(signal, false);
      return () => { signal.cancelled = true; };
    }

    // No cache — full load with skeleton
    fetchDashboard(signal, !hasLoadedOnce.current);

    return () => { signal.cancelled = true; };
  }, [server, sections, cacheKey, refreshTrigger, fetchDashboard]);

  // Auto-refresh when a server activity completes (scan, metadata refresh)
  const prevCompletion = useRef(completionCounter);
  useEffect(() => {
    if (completionCounter > prevCompletion.current) {
      prevCompletion.current = completionCounter;
      refresh();
    }
  }, [completionCounter, refresh]);

  // Refresh stale data when the user navigates back to the dashboard
  const lastFetchTime = useRef(Date.now());
  useEffect(() => {
    // Record when data was last fetched
    if (!isLoading) lastFetchTime.current = Date.now();
  }, [isLoading]);

  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastFetchTime.current > STALE_THRESHOLD
      ) {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { recentMovies, recentShows, onDeck, isLoading, error, refresh };
}
