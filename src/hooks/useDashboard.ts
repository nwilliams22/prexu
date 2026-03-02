import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";
import { getRecentlyAdded, getOnDeck } from "../services/plex-library";
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

/** Simple in-memory cache keyed by server URI */
interface DashboardCache {
  serverUri: string;
  recentMovies: PlexMediaItem[];
  recentShows: GroupedRecentItem[];
  onDeck: PlexMediaItem[];
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cache: DashboardCache | null = null;

export function useDashboard(): UseDashboardResult {
  const { server } = useAuth();
  const [recentMovies, setRecentMovies] = useState<PlexMediaItem[]>(
    () => cache?.recentMovies ?? []
  );
  const [recentShows, setRecentShows] = useState<GroupedRecentItem[]>(
    () => cache?.recentShows ?? []
  );
  const [onDeck, setOnDeck] = useState<PlexMediaItem[]>(
    () => cache?.onDeck ?? []
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = useCallback(() => {
    cache = null;
    setRefreshTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!server) return;

    // If cache is fresh for this server, use it and skip fetch
    if (
      cache &&
      cache.serverUri === server.uri &&
      Date.now() - cache.timestamp < CACHE_TTL_MS
    ) {
      setRecentMovies(cache.recentMovies);
      setRecentShows(cache.recentShows);
      setOnDeck(cache.onDeck);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [recentItems, deckItems] = await Promise.all([
          getRecentlyAdded(server.uri, server.accessToken, 50),
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

          cache = {
            serverUri: server.uri,
            recentMovies: movies,
            recentShows: shows,
            onDeck: deckItems,
            timestamp: Date.now(),
          };
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
  }, [server, refreshTrigger]);

  return { recentMovies, recentShows, onDeck, isLoading, error, refresh };
}
