/**
 * Hook for toggling watched/unwatched state with optimistic UI and rollback.
 *
 * Used by ItemDetail, Dashboard, LibraryView, CollectionDetail, PlaylistDetail.
 */

import { useState, useCallback } from "react";
import { useAuth } from "./useAuth";
import { markAsWatched, markAsUnwatched } from "../services/plex-library";

export interface WatchedToggleResult {
  /** Whether a toggle request is in flight. */
  isToggling: boolean;
  /** Toggle the watched state for a given item. Returns the new watched state. */
  toggle: (ratingKey: string, currentlyWatched: boolean) => Promise<boolean>;
}

/**
 * Provides a toggle function for marking items watched/unwatched.
 *
 * @param onToggled  Optional callback fired after a successful toggle (e.g. to refresh data).
 */
export function useWatchedToggle(onToggled?: () => void): WatchedToggleResult {
  const { server } = useAuth();
  const [isToggling, setIsToggling] = useState(false);

  const toggle = useCallback(
    async (ratingKey: string, currentlyWatched: boolean): Promise<boolean> => {
      if (!server || isToggling) return currentlyWatched;

      setIsToggling(true);
      try {
        if (currentlyWatched) {
          await markAsUnwatched(server.uri, server.accessToken, ratingKey);
        } else {
          await markAsWatched(server.uri, server.accessToken, ratingKey);
        }
        onToggled?.();
        return !currentlyWatched;
      } catch {
        // Rollback: return the original state
        return currentlyWatched;
      } finally {
        setIsToggling(false);
      }
    },
    [server, isToggling, onToggled],
  );

  return { isToggling, toggle };
}
