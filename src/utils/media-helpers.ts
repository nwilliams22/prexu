/**
 * Shared media helper functions.
 *
 * These pure helpers extract display data from Plex media items and are used
 * across Dashboard, LibraryView, CollectionDetail, WatchHistory,
 * PlaylistDetail, SearchResults, and ItemDetail.
 */

import type { PlexMediaItem, PlexEpisode, PlexShow } from "../types/library";

/* ------------------------------------------------------------------ */
/*  Title helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Display title — for episodes returns the show name (grandparentTitle),
 * for everything else returns the item title.
 */
export function getMediaTitle(item: PlexMediaItem): string {
  if (item.type === "episode") {
    const ep = item as PlexEpisode;
    return ep.grandparentTitle || item.title;
  }
  return item.title;
}

/* ------------------------------------------------------------------ */
/*  Subtitle helpers                                                   */
/* ------------------------------------------------------------------ */

export interface SubtitleOptions {
  /** When true, shows include episode count (e.g. "2024 · 24 eps") */
  showEpisodeCount?: boolean;
}

/**
 * Subtitle text for a media item.
 *
 * - Movies: year
 * - Shows: year (optionally + episode count)
 * - Episodes: S01E05 (optionally + episode title)
 */
export function getMediaSubtitle(
  item: PlexMediaItem,
  opts?: SubtitleOptions,
): string {
  if (item.type === "episode") {
    const ep = item as PlexEpisode;
    const code = `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")}`;
    return ep.title ? `${code} · ${ep.title}` : code;
  }

  if (item.type === "show" && opts?.showEpisodeCount) {
    const show = item as PlexShow;
    const parts: string[] = [];
    if (show.year) parts.push(String(show.year));
    if (show.leafCount) parts.push(`${show.leafCount} eps`);
    return parts.join(" · ");
  }

  const withYear = item as { year?: number };
  if (withYear.year) return String(withYear.year);
  return "";
}

/**
 * Short subtitle without episode title — used by Dashboard and SearchResults
 * where the episode title isn't needed in the subtitle.
 */
export function getMediaSubtitleShort(item: PlexMediaItem): string {
  if (item.type === "episode") {
    const ep = item as PlexEpisode;
    return `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")}`;
  }
  const withYear = item as { year?: number };
  if (withYear.year) return String(withYear.year);
  return "";
}

/* ------------------------------------------------------------------ */
/*  Poster helper                                                      */
/* ------------------------------------------------------------------ */

/**
 * Best poster/thumb for display — episodes use the show poster
 * (grandparentThumb) instead of the episode still.
 */
export function getMediaPoster(item: PlexMediaItem): string {
  if (item.type === "episode") {
    const ep = item as PlexEpisode;
    return ep.grandparentThumb || item.thumb;
  }
  return item.thumb;
}

/* ------------------------------------------------------------------ */
/*  Playback progress                                                  */
/* ------------------------------------------------------------------ */

/** Playback progress ratio (0–1), or undefined if not in progress. */
export function getProgress(item: PlexMediaItem): number | undefined {
  const withOffset = item as { viewOffset?: number; duration?: number };
  if (withOffset.viewOffset && withOffset.duration) {
    return withOffset.viewOffset / withOffset.duration;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Watch status                                                       */
/* ------------------------------------------------------------------ */

/** Is this item fully watched? */
export function isWatched(item: PlexMediaItem): boolean {
  const asMovie = item as { viewCount?: number };
  if (asMovie.viewCount !== undefined) return asMovie.viewCount > 0;
  const asShow = item as { viewedLeafCount?: number; leafCount?: number };
  if (
    asShow.viewedLeafCount !== undefined &&
    asShow.leafCount !== undefined
  ) {
    return asShow.leafCount > 0 && asShow.viewedLeafCount >= asShow.leafCount;
  }
  return false;
}

/** Number of unwatched episodes for shows/seasons, or undefined. */
export function getUnwatchedCount(item: PlexMediaItem): number | undefined {
  const asShow = item as { viewedLeafCount?: number; leafCount?: number };
  if (
    asShow.leafCount !== undefined &&
    asShow.viewedLeafCount !== undefined
  ) {
    const count = asShow.leafCount - asShow.viewedLeafCount;
    return count > 0 ? count : undefined;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Time formatting                                                    */
/* ------------------------------------------------------------------ */

/** Format milliseconds to HH:MM:SS or MM:SS for resume display. */
export function formatResumeTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

/* ------------------------------------------------------------------ */
/*  HTML entity decoding                                               */
/* ------------------------------------------------------------------ */

/**
 * Decode HTML entities in Plex API text fields (e.g. `&amp;` → `&`).
 *
 * The Plex API sometimes returns HTML-encoded strings for summaries,
 * titles, and taglines.  This lightweight decoder handles the most
 * common named entities plus numeric (&#123;) and hex (&#x1F;) forms.
 */
const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  hellip: "\u2026",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[\da-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = parseInt(entity.slice(2), 16);
      return isNaN(code) ? match : String.fromCodePoint(code);
    }
    if (entity.startsWith("#")) {
      const code = parseInt(entity.slice(1), 10);
      return isNaN(code) ? match : String.fromCodePoint(code);
    }
    return ENTITY_MAP[entity] ?? match;
  });
}
