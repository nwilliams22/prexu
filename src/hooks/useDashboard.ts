import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";
import { getRecentlyAdded, getOnDeck } from "../services/plex-library";
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

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function useDashboard(): UseDashboardResult {
  const { server } = useAuth();
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

  const refresh = useCallback(() => {
    if (cacheKey) cacheInvalidate(cacheKey);
    setRefreshTrigger((n) => n + 1);
  }, [cacheKey]);

  useEffect(() => {
    if (!server) return;

    // If cache is fresh, use it and skip fetch
    const cached = cacheGet<DashboardData>(cacheKey);
    if (cached) {
      setRecentMovies(cached.recentMovies);
      setRecentShows(cached.recentShows);
      setOnDeck(cached.onDeck);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [recentItems, deckItems] = await Promise.all([
          getRecentlyAdded(server.uri, server.accessToken, 25),
          getOnDeck(server.uri, server.accessToken),
        ]);

        if (!cancelled) {
          const movies = recentItems.filter((i) => i.type === "movie");
          const tvItems = recentItems.filter(
            (i) => i.type === "season" || i.type === "episode"
          );
          const shows = groupRecentlyAdded(tvItems);

          setRecentMovies(movies);
          setRecentShows(shows);
          setOnDeck(deckItems);

          cacheSet(cacheKey, {
            recentMovies: movies,
            recentShows: shows,
            onDeck: deckItems,
          }, CACHE_TTL, true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load dashboard data"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, cacheKey, refreshTrigger]);

  return { recentMovies, recentShows, onDeck, isLoading, error, refresh };
}
