/**
 * Derives the set of filter-relevant values actually present in an
 * already-loaded (client-side) collection of library items.
 *
 * This is the pure computation at the heart of client-side cross-filtering
 * (prexu-hb1p): since PR #55, a filtered library view runs
 * `usePaginatedLibrary`'s `loadAll` path, which progressively fetches the
 * ENTIRE filtered result set in the background. Once that fill completes,
 * every distinct year/contentRating/resolution/genre value in the result set
 * can be read directly off the loaded items — no extra network round trip
 * needed to know "which years actually have documentaries".
 *
 * Deliberately dumb: this module only extracts and dedupes values. Deciding
 * WHEN to apply the derived facets (fill complete? filter already set on that
 * dropdown?) is the composition hook's job (`useConstrainedFilterOptions`).
 *
 * KNOWN LIMITATION: Plex's list endpoints can truncate a media item's
 * `Genre` tag array (only the first few tags are included in bulk listing
 * responses — the full set is only guaranteed on the single-item detail
 * endpoint). So the derived `genres` facet may occasionally miss a rare
 * genre that only appears as a deep (truncated-away) tag on every item that
 * has it. `year`, `contentRating`, and `resolution` are scalar fields and are
 * always present in full on list responses, so those three facets are exact.
 */

/** Minimal shape this module reads from — structurally compatible with
 *  `PlexMediaItem` (and any narrower test fixture) without requiring every
 *  mandatory identity field a full `PlexMediaItem` carries. */
export interface FacetSourceItem {
  year?: number;
  contentRating?: string;
  Media?: { videoResolution?: string }[];
  Genre?: { tag: string }[];
}

export interface DerivedFilterFacets {
  /** Distinct years present, as strings, sorted ascending numerically. */
  years: string[];
  /** Distinct content ratings present, sorted alphabetically. */
  contentRatings: string[];
  /** Distinct video resolutions present, sorted alphabetically. */
  resolutions: string[];
  /** Distinct genre tag names present (as they appear on items), sorted
   *  alphabetically. See the truncation caveat above. */
  genres: string[];
}

/**
 * Scans a sparse-by-index item store (`undefined` slots are unfetched and
 * skipped) and returns the distinct, sorted set of values present for each
 * facet field. Safe to call on a partially-filled store — callers decide
 * whether the result is trustworthy enough to narrow a dropdown with (see
 * `useConstrainedFilterOptions`, which only applies this once the background
 * fill has fully completed).
 */
export function deriveFilterFacets(
  items: (FacetSourceItem | undefined)[]
): DerivedFilterFacets {
  const years = new Set<string>();
  const contentRatings = new Set<string>();
  const resolutions = new Set<string>();
  const genres = new Set<string>();

  for (const item of items) {
    if (!item) continue; // unfetched slot

    if (item.year !== undefined && item.year !== null) {
      years.add(String(item.year));
    }
    if (item.contentRating) {
      contentRatings.add(item.contentRating);
    }
    const resolution = item.Media?.[0]?.videoResolution;
    if (resolution) {
      resolutions.add(resolution);
    }
    if (item.Genre) {
      for (const tag of item.Genre) {
        if (tag?.tag) genres.add(tag.tag);
      }
    }
  }

  return {
    years: Array.from(years).sort((a, b) => Number(a) - Number(b)),
    contentRatings: Array.from(contentRatings).sort(),
    resolutions: Array.from(resolutions).sort(),
    genres: Array.from(genres).sort(),
  };
}
