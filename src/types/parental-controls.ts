export type ContentRatingLevel = "G" | "PG" | "PG-13" | "R" | "NC-17" | "none";

/** Ordered from most restrictive to least. "none" = no restriction. */
export const RATING_LEVELS: ContentRatingLevel[] = [
  "G",
  "PG",
  "PG-13",
  "R",
  "NC-17",
  "none",
];

/** Display labels for the settings UI */
export const RATING_LABELS: Record<ContentRatingLevel, string> = {
  "G": "G — General Audiences",
  "PG": "PG — Parental Guidance",
  "PG-13": "PG-13 — Parents Strongly Cautioned",
  "R": "R — Restricted",
  "NC-17": "NC-17 — Adults Only",
  "none": "No Restriction",
};

/** Map TV content ratings to MPAA equivalents */
const TV_RATING_MAP: Record<string, ContentRatingLevel> = {
  "TV-Y": "G",
  "TV-Y7": "G",
  "TV-Y7-FV": "G",
  "TV-G": "G",
  "TV-PG": "PG",
  "TV-14": "PG-13",
  "TV-MA": "R",
};

/**
 * Normalize a Plex content rating string to a ContentRatingLevel.
 * Handles MPAA ratings, TV ratings, and common international variants.
 * Unknown ratings are treated as the most restrictive ("NC-17")
 * to err on the side of safety for parental controls.
 */
export function normalizeContentRating(plexRating: string | undefined): ContentRatingLevel {
  if (!plexRating) return "NC-17";

  const upper = plexRating.trim().toUpperCase();

  // Direct MPAA match
  if (upper === "G") return "G";
  if (upper === "PG") return "PG";
  if (upper === "PG-13") return "PG-13";
  if (upper === "R") return "R";
  if (upper === "NC-17") return "NC-17";
  if (upper === "NR" || upper === "NOT RATED" || upper === "UNRATED") return "NC-17";

  // TV ratings
  const tvMatch = TV_RATING_MAP[upper];
  if (tvMatch) return tvMatch;

  // Common international mappings
  if (upper === "U" || upper === "0+" || upper === "AL") return "G";
  if (upper === "6+" || upper === "6" || upper === "PG" || upper === "12A") return "PG";
  if (upper === "12" || upper === "12+" || upper === "T") return "PG-13";
  if (upper === "15" || upper === "16" || upper === "16+" || upper === "M" || upper === "MA 15+") return "R";
  if (upper === "18" || upper === "18+" || upper === "X" || upper === "R18") return "NC-17";

  // Unknown — treat as most restrictive for safety
  return "NC-17";
}

/**
 * Check if an item's content rating is allowed under a given max level.
 * Returns true if the item should be visible.
 */
export function isRatingAllowed(
  itemRating: string | undefined,
  maxRating: ContentRatingLevel,
): boolean {
  if (maxRating === "none") return true;

  const normalized = normalizeContentRating(itemRating);
  const itemIndex = RATING_LEVELS.indexOf(normalized);
  const maxIndex = RATING_LEVELS.indexOf(maxRating);

  return itemIndex <= maxIndex;
}

/**
 * Get the list of allowed MPAA rating levels for a given max level.
 * Useful for building server-side filter queries.
 */
export function getAllowedRatingLevels(maxRating: ContentRatingLevel): ContentRatingLevel[] {
  if (maxRating === "none") return [];
  const maxIndex = RATING_LEVELS.indexOf(maxRating);
  return RATING_LEVELS.slice(0, maxIndex + 1);
}

export interface ParentalControlSettings {
  enabled: boolean;
  maxContentRating: ContentRatingLevel;
}

export const DEFAULT_PARENTAL_CONTROLS: ParentalControlSettings = {
  enabled: false,
  maxContentRating: "none",
};
