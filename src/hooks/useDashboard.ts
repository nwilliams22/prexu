import { useState, useEffect } from "react";
import { useAuth } from "./useAuth";
import { getRecentlyAdded, getOnDeck } from "../services/plex-library";
import { groupRecentlyAdded } from "../utils/groupRecentlyAdded";
import type { PlexMediaItem, GroupedRecentItem } from "../types/library";

export interface UseDashboardResult {
  recentlyAdded: GroupedRecentItem[];
  onDeck: PlexMediaItem[];
  isLoading: boolean;
  error: string | null;
}

export function useDashboard(): UseDashboardResult {
  const { server } = useAuth();
  const [recentlyAdded, setRecentlyAdded] = useState<GroupedRecentItem[]>([]);
  const [onDeck, setOnDeck] = useState<PlexMediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server) return;

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
          setRecentlyAdded(groupRecentlyAdded(recentItems));
          setOnDeck(deckItems);
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
  }, [server]);

  return { recentlyAdded, onDeck, isLoading, error };
}
