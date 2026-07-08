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

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Cache key for the playlists list, scoped by server URI (prexu-9f4s.2).
 *
 * Previously a bare `playlists:all`, which served one server's playlists for
 * up to the 5-minute TTL after switching to a different server. Exported so
 * the external invalidators (PlaylistPicker, PlaylistDetail) that mutate
 * playlists stay in sync with this key without hard-coding the format.
 */
export function playlistsCacheKey(uri: string): string {
  return `playlists:${uri}:all`;
}

export function usePlaylists(): UsePlaylistsResult {
  const { server } = useAuth();
  const [playlists, setPlaylists] = useState<PlexPlaylist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const retry = useCallback(() => {
    if (server) cacheInvalidate(playlistsCacheKey(server.uri));
    setRefreshTrigger((n) => n + 1);
  }, [server]);

  useEffect(() => {
    if (!server) return;

    const cacheKey = playlistsCacheKey(server.uri);
    const cached = cacheGet<PlexPlaylist[]>(cacheKey);
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
          cacheSet(cacheKey, videoPlaylists, CACHE_TTL);
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
