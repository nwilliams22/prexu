import { useEffect, useRef } from "react";
import { useQueue } from "../../contexts/QueueContext";
import { getItemMetadata } from "../../services/plex-library";
import { getItemChildren } from "../../services/plex-library/detail";
import type { PlexEpisode } from "../../types/library";
import type { QueueItem } from "../../types/queue";

/**
 * Auto-populate the playback queue when an episode starts playing.
 * Fetches remaining episodes in the current season and queues them.
 */
export function useQueueAutoPopulate(
  serverUri: string | undefined,
  serverToken: string | undefined,
  ratingKey: string | undefined,
  itemType: string | undefined,
) {
  const { setQueue, queue } = useQueue();
  const populatedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!serverUri || !serverToken || !ratingKey || itemType !== "episode") return;

    // Don't re-populate if we already populated for this ratingKey
    if (populatedRef.current === ratingKey) return;

    // Don't re-populate if the queue already contains this ratingKey
    // (user navigated to next ep via queue)
    const inQueue = queue.items.some((item) => item.ratingKey === ratingKey);
    if (inQueue) {
      // Update currentIndex to match
      const idx = queue.items.findIndex((item) => item.ratingKey === ratingKey);
      if (idx !== -1 && idx !== queue.currentIndex) {
        setQueue(queue.items, idx);
      }
      populatedRef.current = ratingKey;
      return;
    }

    populatedRef.current = ratingKey;

    (async () => {
      try {
        const ep = await getItemMetadata<PlexEpisode>(serverUri, serverToken, ratingKey);
        if (!ep || ep.type !== "episode") return;

        // Fetch all episodes in the same season
        const episodes = await getItemChildren<PlexEpisode>(
          serverUri,
          serverToken,
          ep.parentRatingKey,
        );

        // Find current episode's position and include it plus all after
        const currentIdx = episodes.findIndex((e) => e.ratingKey === ratingKey);
        if (currentIdx === -1) return;

        const queueItems: QueueItem[] = episodes.slice(currentIdx).map((e) => ({
          ratingKey: e.ratingKey,
          title: e.grandparentTitle || e.title,
          subtitle: `S${String(e.parentIndex).padStart(2, "0")}E${String(e.index).padStart(2, "0")} \u00b7 ${e.title}`,
          thumb: e.grandparentThumb || e.thumb,
          duration: e.duration,
          type: "episode" as const,
        }));

        if (queueItems.length > 0) {
          setQueue(queueItems, 0); // current episode is index 0
        }
      } catch {
        // silently fail — queue is best-effort
      }
    })();
  }, [serverUri, serverToken, ratingKey, itemType]); // eslint-disable-line react-hooks/exhaustive-deps
}
