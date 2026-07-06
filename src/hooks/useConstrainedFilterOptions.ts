import { useMemo } from "react";
import { deriveFilterFacets, type FacetSourceItem } from "../utils/derive-filter-facets";
import { logger } from "../services/logger";
import type { FilterOption, LibraryFilters } from "../types/library";

export interface ServerFilterOptions {
  genres: FilterOption[];
  years: FilterOption[];
  contentRatings: FilterOption[];
  resolutions: FilterOption[];
}

export interface UseConstrainedFilterOptionsParams {
  /** Full section-wide options from `useFilterOptions` (server directory
   *  endpoints — already result-aware for the WHOLE section, not any single
   *  filtered subset). */
  serverOptions: ServerFilterOptions;
  /** The sparse-by-index item store from `usePaginatedLibrary`. */
  items: (FacetSourceItem | undefined)[];
  /** Whether any filter (genre/year/contentRating/resolution/unwatched) is
   *  currently active. */
  hasActiveFilters: boolean;
  /** Whether `items` is fully (not sparsely) populated — from
   *  `usePaginatedLibrary`'s `isFillComplete`. */
  isFillComplete: boolean;
  /** The currently active filters, used to decide which dropdowns keep
   *  their full server option list vs. get constrained. */
  filters: LibraryFilters;
}

/**
 * Cross-filtered ("faceted") filter dropdown options, derived client-side.
 *
 * Contract (prexu-hb1p):
 *  1. No filters active -> returns `serverOptions` untouched.
 *  2. Filters active but the background fill (`usePaginatedLibrary`'s
 *     `loadAll`) hasn't finished yet -> returns `serverOptions` untouched.
 *     Narrowing off a partial result set would make options flicker/vanish
 *     while a dropdown is open, which is worse than showing some options
 *     that turn out to have zero results.
 *  3. Filters active AND the fill is complete -> each dropdown WITHOUT an
 *     active selection is constrained to only the values actually present
 *     in the loaded (fully-filtered) result set. A dropdown WITH an active
 *     selection keeps its full server list, so the user can still change or
 *     widen that selection.
 *
 * This is deliberately pragmatic "all-but-self" faceting: it does not fetch
 * a separate result set per dropdown (that would multiply network requests
 * back up) — it reuses the one filtered result set already sitting in memory
 * for the currently-active filter combination. See `deriveFilterFacets` for
 * the exactness caveat on the genre facet.
 */
export function useConstrainedFilterOptions(
  params: UseConstrainedFilterOptionsParams
): ServerFilterOptions {
  const { serverOptions, items, hasActiveFilters, isFillComplete, filters } = params;

  const facets = useMemo(() => {
    if (!hasActiveFilters || !isFillComplete) return null;
    return deriveFilterFacets(items);
  }, [hasActiveFilters, isFillComplete, items]);

  const hasYearSelection = !!filters.yearMin || !!filters.yearMax;

  return useMemo(() => {
    if (!facets) {
      return serverOptions;
    }

    const yearSet = new Set(facets.years);
    const contentRatingSet = new Set(facets.contentRatings);
    const resolutionSet = new Set(facets.resolutions);
    // Genre tag text (e.g. "Documentary") isn't guaranteed to share the exact
    // casing of the server option's opaque filter `key` — match on `title`
    // (the human-readable name, which mirrors the tag text) case-insensitively.
    const genreTitleSet = new Set(facets.genres.map((g) => g.toLowerCase()));

    const constrained: ServerFilterOptions = {
      genres: filters.genre
        ? serverOptions.genres
        : serverOptions.genres.filter((g) => genreTitleSet.has(g.title.toLowerCase())),
      // Year-from and year-to share a single option list in FilterBar, so
      // they're gated as one unit: if either bound is already set, keep the
      // full list so the user can still widen the range in either direction.
      years: hasYearSelection
        ? serverOptions.years
        : serverOptions.years.filter((y) => yearSet.has(y.key)),
      contentRatings: filters.contentRating
        ? serverOptions.contentRatings
        : serverOptions.contentRatings.filter((c) => contentRatingSet.has(c.key)),
      resolutions: filters.resolution
        ? serverOptions.resolutions
        : serverOptions.resolutions.filter((r) => resolutionSet.has(r.key)),
    };

    void logger.debug("library", "constrained filter options derived", {
      genreCount: constrained.genres.length,
      yearCount: constrained.years.length,
      contentRatingCount: constrained.contentRatings.length,
      resolutionCount: constrained.resolutions.length,
    });

    return constrained;
  }, [
    facets,
    serverOptions,
    filters.genre,
    filters.contentRating,
    filters.resolution,
    hasYearSelection,
  ]);
}
