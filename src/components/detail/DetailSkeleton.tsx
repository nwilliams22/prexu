import { memo } from "react";

/**
 * Detail-shaped loading placeholder for ItemDetail's true cold-load state
 * (no cached data yet) — replaces the old bare centered spinner with a
 * shimmer skeleton roughly matching the real layout (hero poster + title +
 * meta row, then a couple of horizontal shelves), so the page doesn't
 * "blank" while the first fetch is in flight.
 */
function DetailSkeleton() {
  return (
    <div style={styles.container} aria-busy="true" aria-label="Loading item details">
      <div style={styles.hero}>
        <div className="shimmer" style={styles.poster} />
        <div style={styles.heroInfo}>
          <div className="shimmer" style={styles.title} />
          <div className="shimmer" style={styles.metaRow} />
          <div className="shimmer" style={styles.summaryLine} />
          <div className="shimmer" style={{ ...styles.summaryLine, width: "70%" }} />
          <div className="shimmer" style={{ ...styles.summaryLine, width: "50%" }} />
        </div>
      </div>

      {[0, 1].map((rowIndex) => (
        <div key={rowIndex} style={styles.row}>
          <div className="shimmer" style={styles.rowTitle} />
          <div style={styles.rowCards}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="shimmer"
                style={{ ...styles.card, animationDelay: `${i * 0.08}s` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
  },
  hero: {
    display: "flex",
    gap: "2rem",
    marginBottom: "2rem",
  },
  poster: {
    width: "240px",
    height: "360px",
    borderRadius: "10px",
    flexShrink: 0,
  },
  heroInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "0.85rem",
    paddingTop: "0.5rem",
  },
  title: {
    height: "2.2rem",
    width: "45%",
    borderRadius: "6px",
  },
  metaRow: {
    height: "1rem",
    width: "30%",
    borderRadius: "4px",
  },
  summaryLine: {
    height: "0.9rem",
    width: "90%",
    borderRadius: "4px",
  },
  row: {
    marginBottom: "1.5rem",
  },
  rowTitle: {
    height: "1.15rem",
    width: "160px",
    borderRadius: "4px",
    marginBottom: "0.75rem",
  },
  rowCards: {
    display: "flex",
    gap: "1.25rem",
    overflow: "hidden",
  },
  card: {
    width: "170px",
    height: "255px",
    borderRadius: "8px",
    flexShrink: 0,
  },
};

export default memo(DetailSkeleton);
