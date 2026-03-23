import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePosterSize } from "../hooks/usePosterSize";
import { getImageUrl } from "../services/plex-library";
import HorizontalRow from "./HorizontalRow";
import PosterCard from "./PosterCard";
import type { PlexMediaItem, PlexEpisode } from "../types/library";
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

  if (!server || items.length === 0) return null;

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
        {items.map((item) => {
          const isEpisode = item.type === "episode";
          const ep = isEpisode ? (item as PlexEpisode) : null;
          return (
            <div key={item.ratingKey} style={styles.cardWrapper}>
              <PosterCard
                ratingKey={item.ratingKey}
                imageUrl={posterUrl(ep?.grandparentThumb || item.thumb)}
                title={ep?.grandparentTitle || item.title}
                subtitle={
                  ep
                    ? `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")} · ${ep.title}`
                    : getSubtitle(item)
                }
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
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
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
