import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";
import { getPlaylists } from "../services/plex-library";
import { cacheGet, cacheSet, cacheInvalidate } from "../services/api-cache";
import type { PlexPlaylist } from "../types/library";

export interface UsePlaylistsResult {
  playlists: PlexPlaylist[];
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

const CACHE_KEY = "playlists:all";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function usePlaylists(): UsePlaylistsResult {
  const { server } = useAuth();
  const [playlists, setPlaylists] = useState<PlexPlaylist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const retry = useCallback(() => {
    cacheInvalidate(CACHE_KEY);
    setRefreshTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!server) return;

    const cached = cacheGet<PlexPlaylist[]>(CACHE_KEY);
    if (cached) {
      setPlaylists(cached);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const all = await getPlaylists(server.uri, server.accessToken);
        if (!cancelled) {
          const videoPlaylists = all.filter((p) => p.playlistType === "video");
          setPlaylists(videoPlaylists);
          cacheSet(CACHE_KEY, videoPlaylists, CACHE_TTL);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load playlists"
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, refreshTrigger]);

  return { playlists, isLoading, error, retry };
}
