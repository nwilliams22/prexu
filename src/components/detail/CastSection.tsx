import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import HorizontalRow from "../HorizontalRow";
import { getInitials } from "../../utils/text-format";
import type { PlexRole, PlexTag } from "../../types/library";

interface CastSectionProps {
  roles: PlexRole[] | undefined;
  directors?: PlexTag[] | undefined;
  writers?: PlexTag[] | undefined;
  studio?: string;
  actorThumbUrl: (path: string) => string;
}

export default function CastSection({
  roles,
  directors,
  writers,
  studio,
  actorThumbUrl,
}: CastSectionProps) {
  const navigate = useNavigate();
  const [hoveredCast, setHoveredCast] = useState<string | null>(null);
  const [failedCastImages, setFailedCastImages] = useState<Set<string>>(new Set());

  const handleCastImageError = useCallback((key: string) => {
    setFailedCastImages((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const castItems = (roles ?? []).map((r) => ({
    key: `cast-${r.tag}-${r.role}`,
    name: r.tag,
    subtitle: r.role,
    thumb: r.thumb,
  }));
  const crewItems: typeof castItems = [];
  (directors ?? []).forEach((d) =>
    crewItems.push({ key: `dir-${d.tag}`, name: d.tag, subtitle: "Director", thumb: undefined })
  );
  (writers ?? []).forEach((w) =>
    crewItems.push({ key: `wri-${w.tag}`, name: w.tag, subtitle: "Writer", thumb: undefined })
  );
  const allItems = [...castItems, ...crewItems];
  if (allItems.length === 0 && !studio) return null;

  return (
    <div style={styles.section}>
      <HorizontalRow title="Cast & Crew">
        {allItems.map((person) => {
          const isHovered = hoveredCast === person.key;
          return (
            <div
              key={person.key}
              role="button"
              tabIndex={0}
              style={{ ...styles.castCard, cursor: "pointer" }}
              onClick={() =>
                navigate(`/actor/${encodeURIComponent(person.name)}`, {
                  state: { thumb: person.thumb },
                })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(`/actor/${encodeURIComponent(person.name)}`, {
                    state: { thumb: person.thumb },
                  });
                }
              }}
              onMouseEnter={() => setHoveredCast(person.key)}
              onMouseLeave={() => setHoveredCast(null)}
              onFocus={() => setHoveredCast(person.key)}
              onBlur={() => setHoveredCast(null)}
            >
              {person.thumb && !failedCastImages.has(person.key) ? (
                <img
                  src={actorThumbUrl(person.thumb)}
                  alt={person.name}
                  loading="lazy"
                  onError={() => handleCastImageError(person.key)}
                  style={{
                    ...styles.castPhoto,
                    border: isHovered ? "3px solid var(--accent)" : "3px solid transparent",
                    transform: isHovered ? "scale(1.05)" : "scale(1)",
                    transition: "border-color 0.2s ease, transform 0.2s ease",
                  }}
                />
              ) : (
                <div
                  style={{
                    ...styles.castPhotoFallback,
                    border: isHovered ? "3px solid var(--accent)" : "1px solid var(--border)",
                    transform: isHovered ? "scale(1.05)" : "scale(1)",
                    transition: "border-color 0.2s ease, transform 0.2s ease",
                  }}
                >
                  <span style={styles.castInitials}>{getInitials(person.name)}</span>
                </div>
              )}
              <span style={styles.castCardName}>{person.name}</span>
              {person.subtitle && (
                <span style={styles.castCardRole}>{person.subtitle}</span>
              )}
            </div>
          );
        })}
      </HorizontalRow>
      {studio && typeof studio === "string" && (
        <p style={{ ...styles.crewLine, marginTop: "0.5rem" }}>
          <strong>Studio:</strong> {studio}
        </p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    position: "relative",
    zIndex: 1,
    padding: "1rem 1.5rem",
  },
  castCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "200px",
    flexShrink: 0,
    gap: "0.5rem",
  },
  castPhoto: {
    width: "180px",
    height: "180px",
    borderRadius: "50%",
    objectFit: "cover",
    background: "var(--bg-secondary)",
  },
  castPhotoFallback: {
    width: "180px",
    height: "180px",
    borderRadius: "50%",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  castInitials: {
    fontSize: "2.2rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
  },
  castCardName: {
    fontSize: "1rem",
    fontWeight: 500,
    textAlign: "center",
    lineHeight: 1.3,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as never,
    maxWidth: "100%",
  },
  castCardRole: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    textAlign: "center",
    lineHeight: 1.3,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as never,
    maxWidth: "100%",
  },
  crewLine: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    marginBottom: "0.3rem",
  },
};
