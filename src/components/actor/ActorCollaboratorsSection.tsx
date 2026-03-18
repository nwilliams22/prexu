import type React from "react";
import { useNavigate } from "react-router-dom";
import { getTmdbImageUrl } from "../../services/tmdb";
import { getInitials } from "../../utils/text-format";
import type { Collaborator } from "../../hooks/useFrequentCollaborators";

interface ActorCollaboratorsSectionProps {
  collaborators: Collaborator[];
}

/** Sidebar section showing actors who frequently appear alongside this actor. */
function ActorCollaboratorsSection({ collaborators }: ActorCollaboratorsSectionProps) {
  const navigate = useNavigate();

  if (collaborators.length === 0) return null;

  return (
    <div style={styles.collabSection}>
      <div style={styles.collabHeader}>Frequent Collaborators</div>
      <div style={styles.collabList}>
        {collaborators.map((collab) => {
          const imgUrl = collab.profilePath
            ? getTmdbImageUrl(collab.profilePath, "w92")
            : null;
          return (
            <div
              key={collab.name}
              style={styles.collabItem}
              role="button"
              tabIndex={0}
              onClick={() =>
                navigate(`/actor/${encodeURIComponent(collab.name)}`)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(`/actor/${encodeURIComponent(collab.name)}`);
                }
              }}
            >
              {imgUrl ? (
                <img
                  src={imgUrl}
                  alt={collab.name}
                  style={styles.collabPhoto}
                />
              ) : (
                <div style={styles.collabPhotoFallback}>
                  {getInitials(collab.name)}
                </div>
              )}
              <div style={styles.collabInfo}>
                <span style={styles.collabName}>{collab.name}</span>
                <span style={styles.collabCount}>
                  {collab.count} shared {collab.count === 1 ? "title" : "titles"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ActorCollaboratorsSection;

const styles: Record<string, React.CSSProperties> = {
  collabSection: {
    background: "var(--bg-card)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    overflow: "hidden",
  },
  collabHeader: {
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    padding: "0.5rem 0.75rem",
    borderBottom: "1px solid var(--border)",
  },
  collabList: {
    display: "flex",
    flexDirection: "column",
  },
  collabItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.5rem 0.75rem",
    cursor: "pointer",
    transition: "background 0.15s ease",
    borderBottom: "1px solid var(--border)",
  },
  collabPhoto: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  collabPhotoFallback: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "var(--bg-secondary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.65rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  collabInfo: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    flex: 1,
  },
  collabName: {
    fontSize: "0.8rem",
    fontWeight: 500,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  collabCount: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
  },
};
