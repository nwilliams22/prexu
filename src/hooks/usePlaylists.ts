import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";
import { getPlaylists } from "../services/plex-library";
import type { PlexPlaylist } from "../types/library";

export interface UsePlaylistsResult {
  playlists: PlexPlaylist[];
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

export function usePlaylists(): UsePlaylistsResult {
  const { server } = useAuth();
  const [playlists, setPlaylists] = useState<PlexPlaylist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const retry = useCallback(() => {
    setRefreshTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!server) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const all = await getPlaylists(server.uri, server.accessToken);
        if (!cancelled) {
          // Filter to video playlists only
          setPlaylists(all.filter((p) => p.playlistType === "video"));
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
