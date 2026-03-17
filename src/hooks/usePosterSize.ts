/**
 * Hook for responsive poster sizing based on breakpoint and user preferences.
 *
 * Centralizes the POSTER_SIZES logic from Dashboard and other pages.
 */

import { useBreakpoint } from "./useBreakpoint";
import { usePreferences } from "./usePreferences";

type PosterSize = "small" | "medium" | "large";

/** Poster widths for standard breakpoints (mobile/tablet/desktop). */
const POSTER_SIZES = { small: 150, medium: 190, large: 230 } as const;

/** Poster widths for large breakpoint. */
const POSTER_SIZES_LARGE = { small: 190, medium: 230, large: 280 } as const;

export interface PosterSizeResult {
  /** Poster width in pixels, based on breakpoint and user preference. */
  posterWidth: number;
  /** Poster height in pixels (posterWidth × aspectRatio). */
  posterHeight: number;
  /** The raw user preference value. */
  preference: PosterSize;
}

/**
 * Get responsive poster dimensions based on breakpoint and user preference.
 *
 * @param aspectRatio  Height-to-width ratio (default 1.5 for standard 2:3 posters).
 */
export function usePosterSize(aspectRatio = 1.5): PosterSizeResult {
  const bp = useBreakpoint();
  const { preferences } = usePreferences();

  const preference = preferences.appearance.posterSize;
  const sizeMap = bp === "large" ? POSTER_SIZES_LARGE : POSTER_SIZES;
  const posterWidth = sizeMap[preference];
  const posterHeight = Math.round(posterWidth * aspectRatio);

  return { posterWidth, posterHeight, preference };
}
