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
