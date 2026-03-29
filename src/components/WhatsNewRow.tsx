import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePosterSize } from "../hooks/usePosterSize";
import { getImageUrl } from "../services/plex-library";
import { groupRecentlyAdded } from "../utils/groupRecentlyAdded";
import HorizontalRow from "./HorizontalRow";
import PosterCard from "./PosterCard";
import type { PlexMediaItem } from "../types/library";
import { getMediaSubtitleShort as getSubtitle } from "../utils/media-helpers";

interface WhatsNewRowProps {
  items: PlexMediaItem[];
  onDismissItem: (ratingKey: string) => void;
  onDismissAll: () => void;
}

function WhatsNewRow({ items, onDismissItem, onDismissAll }: WhatsNewRowProps) {
  const { server } = useAuth();
  const navigate = useNavigate();
  const { posterWidth } = usePosterSize();

  const grouped = useMemo(() => groupRecentlyAdded(items), [items]);

  if (!server || grouped.length === 0) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <h3 style={styles.title}>New Since Your Last Visit</h3>
        <button onClick={onDismissAll} style={styles.dismissAllButton}>
          Dismiss All
        </button>
      </div>
      <HorizontalRow title="">
        {grouped.map((group) => {
          if (group.kind === "movie") {
            const item = group.representativeItem;
            return (
              <div key={group.groupKey} style={styles.cardWrapper}>
                <PosterCard
                  ratingKey={item.ratingKey}
                  imageUrl={posterUrl(item.thumb)}
                  title={item.title}
                  subtitle={getSubtitle(item as PlexMediaItem)}
                  badge="NEW"
                  width={posterWidth}
                  onClick={() => navigate(`/item/${item.ratingKey}`)}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismissItem(item.ratingKey);
                  }}
                  style={styles.dismissButton}
                  aria-label={`Dismiss ${item.title}`}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1={18} y1={6} x2={6} y2={18} />
                    <line x1={6} y1={6} x2={18} y2={18} />
                  </svg>
                </button>
              </div>
            );
          }

          // Show group — multiple seasons/episodes collapsed into one card
          const hasMultipleSeasons = group.seasonIndices.length > 1;
          const badge = hasMultipleSeasons ? "NEW SEASONS" : "NEW";
          const subtitle = hasMultipleSeasons
            ? `Seasons ${group.seasonIndices.sort((a, b) => a - b).join(", ")}`
            : group.seasonIndices.length === 1
              ? `Season ${group.seasonIndices[0]}`
              : group.episodes.length > 0
                ? `${group.episodeCount} episode${group.episodeCount !== 1 ? "s" : ""}`
                : "";

          // Navigate to the show page, not an individual season
          const showKey = group.groupKey;

          // All original ratingKeys in this group for dismissal
          const groupRatingKeys = group.itemRatingKeys;

          return (
            <div key={group.groupKey} style={styles.cardWrapper}>
              <PosterCard
                ratingKey={showKey}
                imageUrl={posterUrl(group.thumb)}
                title={group.title}
                subtitle={subtitle}
                badge={badge}
                width={posterWidth}
                onClick={() => navigate(`/item/${showKey}`)}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  for (const key of groupRatingKeys) {
                    onDismissItem(key);
                  }
                }}
                style={styles.dismissButton}
                aria-label={`Dismiss ${group.title}`}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1={18} y1={6} x2={6} y2={18} />
                  <line x1={6} y1={6} x2={18} y2={18} />
                </svg>
              </button>
            </div>
          );
        })}
      </HorizontalRow>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    marginBottom: "0.5rem",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.25rem",
  },
  title: {
    fontSize: "1.15rem",
    fontWeight: 600,
    margin: 0,
  },
  dismissAllButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.8rem",
    padding: "4px 8px",
    borderRadius: "4px",
    border: "1px solid var(--border)",
    cursor: "pointer",
  },
  cardWrapper: {
    position: "relative" as const,
    flexShrink: 0,
  },
  dismissButton: {
    position: "absolute" as const,
    top: "6px",
    right: "6px",
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    background: "rgba(0, 0, 0, 0.7)",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: "none",
    cursor: "pointer",
    zIndex: 2,
    opacity: 0,
    transition: "opacity 0.15s",
  },
};

// CSS hover for dismiss button visibility is handled inline via parent hover
// Since we're using inline styles, we'll use a simple approach
export default WhatsNewRow;
