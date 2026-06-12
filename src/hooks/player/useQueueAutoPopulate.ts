import { useEffect, useRef } from "react";
import { useQueue } from "../../contexts/QueueContext";
import { getItemMetadata } from "../../services/plex-library";
import { getItemChildren } from "../../services/plex-library/detail";
import type { PlexEpisode, PlexSeason } from "../../types/library";
import type { QueueItem } from "../../types/queue";
import { logger } from "../../services/logger";

/**
 * Auto-populate the playback queue when an episode starts playing.
 * Fetches remaining episodes in the current season and queues them.
 * When the current episode is the last in its season, the first episode
 * of the next season is appended so cross-season autoplay works.
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
    // (user navigated to next ep via queue). Preserve the existing
    // queue.source — could be "user-built" if the user Play-All'd a
    // playlist whose first item happens to be an episode, in which case
    // we MUST NOT downgrade it to "auto-episodes".
    const inQueue = queue.items.some((item) => item.ratingKey === ratingKey);
    if (inQueue) {
      // Update currentIndex to match
      const idx = queue.items.findIndex((item) => item.ratingKey === ratingKey);
      if (idx !== -1 && idx !== queue.currentIndex) {
        setQueue(queue.items, idx, queue.shuffled, queue.source);
      }
      populatedRef.current = ratingKey;
      return;
    }

    populatedRef.current = ratingKey;

    // Clear any stale queue immediately (e.g. a previous session persisted
    // in localStorage) so hasNextItem does not read wrong data during the
    // async fetch. The queue is replaced once the fetch resolves.
    setQueue([], -1, undefined, "auto-episodes");

    (async () => {
      try {
        const ep = await getItemMetadata<PlexEpisode>(serverUri, serverToken, ratingKey);
        if (!ep || ep.type !== "episode") return;

        // Fetch all episodes in the same season
        const seasonEpisodes = await getItemChildren<PlexEpisode>(
          serverUri,
          serverToken,
          ep.parentRatingKey,
        );

        // Find current episode's position and include it plus all after
        const currentIdx = seasonEpisodes.findIndex((e) => e.ratingKey === ratingKey);
        if (currentIdx === -1) return;

        const remainingInSeason = seasonEpisodes.slice(currentIdx);

        const toQueueItem = (e: PlexEpisode): QueueItem => ({
          ratingKey: e.ratingKey,
          title: e.grandparentTitle || e.title,
          subtitle: `S${String(e.parentIndex).padStart(2, "0")}E${String(e.index).padStart(2, "0")} · ${e.title}`,
          thumb: e.grandparentThumb || e.thumb,
          duration: e.duration,
          type: "episode" as const,
        });

        const queueItems: QueueItem[] = remainingInSeason.map(toQueueItem);

        // When the current episode is the last in its season, fetch the
        // next season's episodes and append them so cross-season autoplay
        // works. Without this the queue ends at the season finale and
        // PostPlay has no nextQueueItem to show or advance to (prexu-0cs).
        if (remainingInSeason.length === 1) {
          try {
            const seasons = await getItemChildren<PlexSeason>(
              serverUri,
              serverToken,
              ep.grandparentRatingKey,
            );
            const currentSeasonIdx = seasons.findIndex(
              (s) => s.ratingKey === ep.parentRatingKey,
            );
            if (currentSeasonIdx >= 0 && currentSeasonIdx < seasons.length - 1) {
              const nextSeason = seasons[currentSeasonIdx + 1];
              const nextSeasonEps = await getItemChildren<PlexEpisode>(
                serverUri,
                serverToken,
                nextSeason.ratingKey,
              );
              if (nextSeasonEps.length > 0) {
                queueItems.push(...nextSeasonEps.map(toQueueItem));
                logger.debug("queue", "appended next season to queue", {
                  nextSeasonRatingKey: nextSeason.ratingKey,
                  appendedCount: nextSeasonEps.length,
                });
              }
            }
          } catch (err) {
            // Best-effort — if next-season fetch fails the current-season
            // queue is still usable; cross-season autoplay falls back to
            // the Plex episode-nav API path via useEpisodeNavigation.
            logger.warn("queue", "next-season fetch failed", String(err));
          }
        }

        if (queueItems.length > 0) {
          // Tag as auto-episodes so movie playback won't see this stale
          // queue and pop PostPlay against it (see Player.tsx hasNextItem).
          logger.debug("queue", "auto-populated episode queue", {
            ratingKey,
            queueLength: queueItems.length,
          });
          setQueue(queueItems, 0, undefined, "auto-episodes"); // current episode is index 0
        }
      } catch (err) {
        logger.warn("queue", "auto-populate failed", String(err));
      }
    })();
  }, [serverUri, serverToken, ratingKey, itemType]); // eslint-disable-line react-hooks/exhaustive-deps
}
