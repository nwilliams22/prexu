import { memo } from "react";
import SkeletonCard from "../SkeletonCard";

interface ShelfSkeletonProps {
  /** Poster card width — pass the same width the real shelf's cards use. */
  cardWidth?: number;
  /** Poster card aspect ratio — pass the same ratio the real shelf's cards use. */
  aspectRatio?: number;
  /** How many placeholder cards to show. */
  count?: number;
  /** Which shelf this stands in for (related/extras/actors/collection) — suffixes the test id. */
  shelf?: string;
}

/**
 * Reserved-space placeholder for a still-loading ItemDetail shelf
 * (related/extras/more-with-actor/collection). Sized to approximate a real
 * HorizontalRow of PosterCards so that when the actual shelf data arrives it
 * replaces this placeholder instead of popping in below already-painted
 * content — see prexu-ct5k: a warm-cache entry paints the hero/cast
 * instantly, but the shelf fetches land a few hundred ms later, and without
 * reserved space their arrival pushes/reflows the page in a way that reads
 * as a refresh.
 */
function ShelfSkeleton({ cardWidth = 230, aspectRatio = 1.5, count = 6, shelf }: ShelfSkeletonProps) {
  return (
    <div
      style={styles.section}
      aria-hidden="true"
      data-testid={shelf ? `shelf-skeleton-${shelf}` : "shelf-skeleton"}
    >
      <div className="shimmer" style={styles.title} />
      <div style={styles.row}>
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonCard key={i} width={cardWidth} aspectRatio={aspectRatio} index={i} />
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    position: "relative",
    zIndex: 1,
    padding: "1rem 1.5rem",
  },
  title: {
    height: "1.15rem",
    width: "160px",
    borderRadius: "4px",
    marginBottom: "0.75rem",
  },
  row: {
    display: "flex",
    gap: "1.25rem",
    overflow: "hidden",
  },
};

export default memo(ShelfSkeleton);
