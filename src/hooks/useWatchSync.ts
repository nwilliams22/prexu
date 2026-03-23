/**
 * Syncs offline watch state back to the Plex server.
 *
 * When items are watched via downloaded files while offline,
 * their ratingKeys are queued in localStorage. This hook
 * processes the queue when the server becomes available,
 * marking each item as watched on the server.
 */

import { useEffect, useRef } from "react";
import { markAsWatched } from "../services/plex-library";
import {
  getPendingWatchSync,
  removePendingWatchSync,
} from "../services/storage";

export function useWatchSync(
  server: { uri: string; accessToken: string } | null,
) {
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!server || syncingRef.current) return;

    const sync = async () => {
      syncingRef.current = true;
      try {
        const pending = await getPendingWatchSync();
        if (pending.length === 0) return;

        for (const item of pending) {
          try {
            await markAsWatched(server.uri, server.accessToken, item.ratingKey);
            await removePendingWatchSync(item.ratingKey);
          } catch {
            // Server may still be unreachable for this item — leave in queue
            break;
          }
        }
      } finally {
        syncingRef.current = false;
      }
    };

    sync();
  }, [server]);
}
