/**
 * Shared hero-section styles for detail pages (CollectionDetail, ItemDetail).
 *
 * These define the full-bleed background art, gradient overlay, and
 * poster + info hero layout used across detail pages.
 *
 * Usage:
 *   import { detailStyles } from "../utils/detail-styles";
 *   const styles = { ...detailStyles, ...pageSpecificStyles };
 *   // or spread individual keys: { ...detailStyles.heroPoster, width: 280 }
 */

export const detailStyles: Record<string, React.CSSProperties> = {
  /* ---------- Background Art ---------- */

  /** Full-bleed background image (art available) */
  pageBgArt: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center 20%",
    filter: "blur(4px) brightness(0.35)",
    transform: "scale(1.02)",
    pointerEvents: "none",
  },

  /** Fallback: blurred poster when no art is available */
  pageBgArtFallback: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center 30%",
    filter: "blur(30px) brightness(0.3) saturate(1.4)",
    transform: "scale(1.1)",
    pointerEvents: "none",
  },

  /** Gradient overlay that fades background into page color */
  pageBgOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background:
      "linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.3) 30%, var(--bg-primary) 85%)",
    pointerEvents: "none",
  },

  /* ---------- Hero Layout ---------- */

  /** Flex container: poster left, info right */
  heroContent: {
    position: "relative",
    display: "flex",
    gap: "2.5rem",
    padding: "2.5rem 2.5rem 2rem",
    width: "100%",
    zIndex: 1,
  },

  /** Poster image (240px wide, rounded, shadow) */
  heroPoster: {
    width: "240px",
    borderRadius: "10px",
    boxShadow: "0 6px 30px rgba(0,0,0,0.6)",
    flexShrink: 0,
    objectFit: "cover",
  },

  /** Info column to the right of the poster */
  heroInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
    justifyContent: "flex-start",
  },

  /** Page title (h1) */
  heroTitle: {
    fontSize: "2.4rem",
    fontWeight: 700,
    lineHeight: 1.2,
  },

  /** Horizontal metadata row (year, rating, duration, etc.) */
  metaRow: {
    display: "flex",
    gap: "0.85rem",
    fontSize: "1rem",
    color: "var(--text-secondary)",
    flexWrap: "wrap",
    alignItems: "center",
  },

  /* ---------- Responsive (mobile) ---------- */

  heroContentMobile: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: "1.25rem",
    padding: "1.5rem 1rem 1rem",
    width: "100%",
    zIndex: 1,
  },

  heroPosterMobile: {
    width: "160px",
    borderRadius: "8px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    flexShrink: 0,
    objectFit: "cover",
  },

  heroTitleMobile: {
    fontSize: "1.6rem",
    fontWeight: 700,
    lineHeight: 1.2,
  },

  metaRowMobile: {
    display: "flex",
    gap: "0.5rem",
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
  },

  /* ---------- Responsive (large) ---------- */

  heroPosterLarge: {
    width: "280px",
    borderRadius: "10px",
    boxShadow: "0 6px 30px rgba(0,0,0,0.6)",
    flexShrink: 0,
    objectFit: "cover",
  },

  heroTitleLarge: {
    fontSize: "2.8rem",
    fontWeight: 700,
    lineHeight: 1.2,
  },
};
