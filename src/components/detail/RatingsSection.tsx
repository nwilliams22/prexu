import {
  buildRatingBadges,
  TomatoIcon,
  PopcornIcon,
  ImdbIcon,
  TmdbIcon,
} from "../../utils/rating-badges";
import type { PlexRating } from "../../types/library";

interface RatingsSectionProps {
  ratings?: PlexRating[];
  rating: number;
  audienceRating: number;
  ratingImage?: string;
  audienceRatingImage?: string;
}

export default function RatingsSection({
  ratings,
  rating,
  audienceRating,
  ratingImage,
  audienceRatingImage,
}: RatingsSectionProps) {
  const badges = buildRatingBadges(
    ratings,
    rating,
    audienceRating,
    ratingImage,
    audienceRatingImage,
  );

  if (badges.length === 0) return null;

  return (
    <div style={styles.section}>
      <h3 style={styles.title}>Ratings</h3>
      <div style={styles.grid}>
        {badges.map((b) => (
          <div key={b.source} style={styles.card}>
            <div style={styles.icon}>
              {b.source === "imdb" && <ImdbIcon />}
              {b.source === "rt-critic" && <TomatoIcon />}
              {b.source === "rt-audience" && <PopcornIcon />}
              {b.source === "tmdb" && <TmdbIcon />}
              {b.source === "generic" && (
                <span style={styles.genericIcon}>★</span>
              )}
            </div>
            <span style={styles.value}>{b.display}</span>
            <span style={styles.label}>{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    padding: "0 2.5rem",
    marginBottom: "1.5rem",
  },
  title: {
    fontSize: "1.2rem",
    fontWeight: 600,
    marginBottom: "0.75rem",
  },
  grid: {
    display: "flex",
    gap: "0.75rem",
    flexWrap: "wrap",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.35rem",
    padding: "0.75rem 1.25rem",
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    minWidth: 90,
  },
  icon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "18px",
    lineHeight: 1,
  },
  value: {
    fontSize: "1.4rem",
    fontWeight: 700,
    color: "var(--text-primary)",
    lineHeight: 1,
  },
  label: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
    fontWeight: 500,
  },
  genericIcon: {
    fontSize: "18px",
    color: "var(--accent)",
  },
};
