/**
 * Shared "Play All" / "Shuffle" actions for detail pages.
 *
 * CollectionDetail and PlaylistDetail had byte-identical handlers for building
 * a queue from their items and starting playback. Extracted here so the logic
 * lives in one place.
 */

import { useCallback } from "react";
import { usePlayerSession } from "../contexts/PlayerContext";
import { useQueue } from "../contexts/QueueContext";
import { buildQueueFromItems, shuffleArray } from "../utils/queue-helpers";
import { logger } from "../services/logger";
import type { PlexMediaItem } from "../types/library";

export interface UsePlayAllResult {
  /** True if any item is a playable type (movie/episode). */
  hasPlayableItems: boolean;
  playAll: () => void;
  shuffle: () => void;
}

export function usePlayAll(items: PlexMediaItem[]): UsePlayAllResult {
  const { play } = usePlayerSession();
  const { setQueue } = useQueue();

  const hasPlayableItems = items.some(
    (i) => i.type === "movie" || i.type === "episode",
  );

  const playAll = useCallback(() => {
    const queueItems = buildQueueFromItems(items);
    if (queueItems.length === 0) return;
    logger.info("detail", "play all", { count: queueItems.length });
    setQueue(queueItems, 0, false, "user-built");
    play(queueItems[0]!.ratingKey);
  }, [items, setQueue, play]);

  const shuffle = useCallback(() => {
    const queueItems = shuffleArray(buildQueueFromItems(items));
    if (queueItems.length === 0) return;
    logger.info("detail", "shuffle play", { count: queueItems.length });
    setQueue(queueItems, 0, true, "user-built");
    play(queueItems[0]!.ratingKey);
  }, [items, setQueue, play]);

  return { hasPlayableItems, playAll, shuffle };
}
