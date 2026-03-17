/**
 * Rating badge parsing and rendering for Plex media items.
 * Supports IMDb, Rotten Tomatoes (critic + audience), TMDb, and generic ratings.
 */

import type { PlexRating } from "../types/library";

/** Parsed rating badge ready for display */
export interface RatingBadge {
  source: "imdb" | "rt-critic" | "rt-audience" | "tmdb" | "generic";
  label: string;
  display: string;
}

/** Parse a PlexRating or legacy ratingImage into a displayable badge */
export function parseRatingBadge(
  image: string,
  value: number,
  kind: "critic" | "audience"
): RatingBadge | null {
  if (!image || value <= 0) return null;
  if (image.startsWith("imdb://")) {
    return { source: "imdb", label: "IMDb", display: value.toFixed(1) };
  }
  if (image.startsWith("rottentomatoes://")) {
    const pct = `${Math.round(value * 10)}%`;
    return {
      source: kind === "critic" ? "rt-critic" : "rt-audience",
      label: kind === "critic" ? "Critics" : "Audience",
      display: pct,
    };
  }
  if (image.startsWith("themoviedb://")) {
    return { source: "tmdb", label: "TMDB", display: value.toFixed(1) };
  }
  return {
    source: "generic",
    label: kind === "critic" ? "Critic" : "Audience",
    display: value.toFixed(1),
  };
}

/** Build badges from Rating[] array (preferred) or legacy fields */
export function buildRatingBadges(
  ratings: PlexRating[] | undefined,
  rating: number,
  audienceRating: number,
  ratingImage?: string,
  audienceRatingImage?: string
): RatingBadge[] {
  const badges: RatingBadge[] = [];
  const seen = new Set<string>();

  // Prefer the Rating[] array — contains all sources
  if (ratings && ratings.length > 0) {
    for (const r of ratings) {
      const kind = r.type === "audience" ? "audience" : "critic";
      const badge = parseRatingBadge(r.image, r.value, kind);
      if (badge && !seen.has(badge.source)) {
        seen.add(badge.source);
        badges.push(badge);
      }
    }
  }

  // Fallback to legacy fields if Rating[] didn't provide data
  if (badges.length === 0) {
    const critic = parseRatingBadge(ratingImage ?? "", rating, "critic");
    if (critic) {
      badges.push(critic);
      seen.add(critic.source);
    } else if (rating > 0) {
      badges.push({ source: "generic", label: "Critic", display: rating.toFixed(1) });
    }

    const audience = parseRatingBadge(audienceRatingImage ?? "", audienceRating, "audience");
    if (audience && !seen.has(audience.source)) {
      badges.push(audience);
    } else if (audienceRating > 0 && !seen.has("rt-audience")) {
      badges.push({ source: "generic", label: "Audience", display: audienceRating.toFixed(1) });
    }
  }

  return badges;
}

// ── Badge Icon Components ──

/** RT Tomato emoji badge (critic) */
export const TomatoIcon = () => (
  <span role="img" aria-label="Rotten Tomatoes Critics" style={{ fontSize: "14px", lineHeight: 1 }}>
    🍅
  </span>
);

/** RT Popcorn emoji badge (audience) */
export const PopcornIcon = () => (
  <span role="img" aria-label="Rotten Tomatoes Audience" style={{ fontSize: "14px", lineHeight: 1 }}>
    🍿
  </span>
);

/** IMDb logo badge */
export const ImdbIcon = () => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#F5C518",
      color: "#000",
      fontWeight: 800,
      fontSize: "9px",
      letterSpacing: "0.5px",
      padding: "1px 4px",
      borderRadius: "3px",
      lineHeight: 1.2,
      fontFamily: "Arial, sans-serif",
    }}
    aria-label="IMDb"
  >
    IMDb
  </span>
);

/** TMDB logo badge */
export const TmdbIcon = () => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#01B4E4",
      color: "#fff",
      fontWeight: 700,
      fontSize: "8px",
      letterSpacing: "0.3px",
      padding: "1px 4px",
      borderRadius: "3px",
      lineHeight: 1.2,
      fontFamily: "Arial, sans-serif",
    }}
    aria-label="TMDB"
  >
    TMDB
  </span>
);
