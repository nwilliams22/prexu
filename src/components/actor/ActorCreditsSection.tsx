import type React from "react";
import { useNavigate } from "react-router-dom";
import type { TmdbCreditEntry } from "../../services/tmdb";
import type { PlexMediaItem } from "../../types/library";
import { getYear } from "../../utils/actor-helpers";

interface ActorCreditsSectionProps {
  credits: TmdbCreditEntry[];
  serverItemMap: Map<string, PlexMediaItem>;
}

/** Filmography table: all acting credits sorted by year, with "On Server" badges. */
function ActorCreditsSection({ credits, serverItemMap }: ActorCreditsSectionProps) {
  const navigate = useNavigate();

  // Build filmography list (cast credits sorted by year desc, deduped)
  const filmography = (() => {
    const seen = new Set<number>();
    return credits
      .filter((c) => c.character)
      .sort((a, b) => {
        const ya = getYear(a.release_date ?? a.first_air_date);
        const yb = getYear(b.release_date ?? b.first_air_date);
        return yb - ya;
      })
      .filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
  })();

  if (filmography.length === 0) return null;

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Filmography</h2>
      <div style={styles.filmographyList}>
        {filmography.map((c) => {
          const title = c.title ?? c.name ?? "";
          const year = getYear(c.release_date ?? c.first_air_date);
          const serverItem = serverItemMap.get(title.toLowerCase()) ?? null;
          const onServer = !!serverItem;
          const handleClick = serverItem
            ? () => navigate(`/item/${serverItem.ratingKey}`)
            : () => navigate(`/discover/${c.media_type}/${c.id}`);
          return (
            <div
              key={`film-${c.id}-${c.media_type}`}
              style={{ ...styles.filmographyRow, cursor: "pointer" }}
              onClick={handleClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleClick();
                }
              }}
            >
              <span style={styles.filmYear}>{year || "\u2014"}</span>
              <span style={styles.filmTitle}>{title}</span>
              {c.character && (
                <span style={styles.filmRole}> · as {c.character}</span>
              )}
              {onServer ? (
                <span style={styles.onServerBadge}>On Server</span>
              ) : (
                <span style={styles.requestBadge}>Request</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ActorCreditsSection;

const styles: Record<string, React.CSSProperties> = {
  section: {
    marginBottom: "2rem",
  },
  sectionTitle: {
    fontSize: "1.25rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: "0 0 1rem 0",
  },
  filmographyList: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    maxWidth: "800px",
  },
  filmographyRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.6rem 0.75rem",
    borderRadius: "6px",
    fontSize: "0.9rem",
    transition: "background 0.15s",
  },
  filmYear: {
    width: "40px",
    flexShrink: 0,
    color: "var(--text-secondary)",
    fontWeight: 500,
    fontSize: "0.85rem",
  },
  filmTitle: {
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  filmRole: {
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
  },
  onServerBadge: {
    marginLeft: "auto",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--accent)",
    flexShrink: 0,
  },
  requestBadge: {
    marginLeft: "auto",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    flexShrink: 0,
    opacity: 0.6,
  },
};
