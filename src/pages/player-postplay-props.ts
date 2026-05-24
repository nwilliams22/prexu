/**
 * Adapter from the enriched-metadata fetch result (PlexEpisode | PlexMediaItem)
 * to the subset of PostPlayScreen props that derive from it.
 *
 * Extracted from Player.tsx (prexu-ps6) to keep the JSX render compact.
 * Pure — no React, no hooks, easy to unit-test if needed later. PostPlay
 * still renders immediately from the lightweight QueueItem fields; this
 * just lights up the richer fields when the detail fetch lands.
 *
 * Returns every field as a separate property so the JSX call site can
 * spread directly into <PostPlayScreen>. Each field stays optional
 * (undefined when not available) — matches PostPlayScreen's contract.
 */

import type { PlexEpisode, PlexMediaItem } from "../types/library";
import type { PlaybackQueue, QueueItem } from "../types/queue";

export interface DerivedPostPlayDetailProps {
  synopsis: string | undefined;
  airDate: string | undefined;
  watched: boolean | undefined;
  directors: string[] | undefined;
  cast: string[] | undefined;
}

export function derivePostPlayDetailProps(
  detail: PlexEpisode | PlexMediaItem | null,
): DerivedPostPlayDetailProps {
  if (!detail) {
    return {
      synopsis: undefined,
      airDate: undefined,
      watched: undefined,
      directors: undefined,
      cast: undefined,
    };
  }
  const airDate =
    "originallyAvailableAt" in detail && detail.originallyAvailableAt
      ? new Date(detail.originallyAvailableAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : undefined;
  const directors =
    "Director" in detail
      ? detail.Director?.map((d) => d.tag).slice(0, 3)
      : undefined;
  const cast =
    "Role" in detail ? detail.Role?.map((r) => r.tag).slice(0, 3) : undefined;
  return {
    synopsis: detail.summary || undefined,
    airDate,
    watched: ((detail as { viewCount?: number }).viewCount ?? 0) > 0,
    directors,
    cast,
  };
}

/**
 * "Coming up" strip for PostPlayScreen — items after the next one in the
 * queue, capped at 4 so the strip stays short. The next item itself is
 * the hero card so we skip currentIndex+1 and start at +2.
 *
 * Returns undefined when there's nothing left to show — PostPlayScreen
 * checks that to decide whether to render the strip at all. Empty array
 * would force the section to mount with no children.
 */
export function deriveUpNextSlice(
  queue: PlaybackQueue,
): QueueItem[] | undefined {
  const start = queue.currentIndex + 2;
  const slice = queue.items.slice(start, start + 4);
  return slice.length > 0 ? slice : undefined;
}
