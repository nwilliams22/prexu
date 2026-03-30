import { useNavigate } from "react-router-dom";
import { useBreakpoint, isMobile } from "../../hooks/useBreakpoint";
import { decodeHtmlEntities } from "../../utils/media-helpers";
import type { PlexEpisode } from "../../types/library";

interface EpisodeListSectionProps {
  episodes: PlexEpisode[];
  seasonFading: boolean;
  episodeThumbUrl: (path: string) => string;
  formatDuration: (ms: number) => string;
}

export default function EpisodeListSection({
  episodes,
  seasonFading,
  episodeThumbUrl,
  formatDuration,
}: EpisodeListSectionProps) {
  const navigate = useNavigate();
  const bp = useBreakpoint();
  const mobile = isMobile(bp);

  return (
    <div style={{
      ...styles.section,
      opacity: seasonFading ? 0 : 1,
      transition: "opacity 0.15s ease",
    }}>
      <h2 style={styles.sectionTitle}>
        {episodes.length} Episode{episodes.length !== 1 ? "s" : ""}
      </h2>

      <div style={{
        display: "grid",
        gridTemplateColumns: bp === "large" ? "1fr 1fr" : bp === "desktop" ? "1fr 1fr" : "1fr",
        gap: mobile ? "0.75rem" : "1rem",
      }}>
        {episodes.map((ep) => {
          const isWatched = (ep as PlexEpisode & { viewCount?: number }).viewCount != null
            && (ep as PlexEpisode & { viewCount?: number }).viewCount! > 0;
          const airDate = ep.originallyAvailableAt
            ? new Date(ep.originallyAvailableAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
            : null;
          return (
            <button
              key={ep.ratingKey}
              onClick={() => navigate(`/item/${ep.ratingKey}`)}
              style={{
                ...styles.episodeGridCard,
                ...(mobile ? { flexDirection: "column" as const } : {}),
              }}
            >
              <div style={{
                ...styles.episodeGridThumbWrap,
                ...(mobile ? { width: "100%", minWidth: "unset" } : {}),
              }}>
                <img
                  src={episodeThumbUrl(ep.thumb)}
                  alt={ep.title}
                  style={styles.episodeGridThumb}
                  loading="lazy"
                />
                {isWatched && (
                  <div style={styles.episodeWatchedBadge}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
                {ep.duration && (
                  <span style={styles.episodeDuration}>{formatDuration(ep.duration)}</span>
                )}
              </div>
              <div style={styles.episodeGridInfo}>
                <span style={styles.episodeGridNumber}>Episode {ep.index}{airDate ? ` \u00b7 ${airDate}` : ""}</span>
                <span style={styles.episodeGridTitle}>{ep.title}</span>
                {ep.summary && (
                  <span style={styles.episodeSynopsis}>{decodeHtmlEntities(ep.summary)}</span>
                )}
              </div>
            </button>
          );
        })}
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
  sectionTitle: {
    fontSize: "1.15rem",
    fontWeight: 600,
    marginBottom: "0.75rem",
  },
  episodeGridCard: {
    display: "flex",
    flexDirection: "row",
    background: "transparent",
    border: "none",
    padding: 0,
    color: "var(--text-primary)",
    textAlign: "left",
    cursor: "pointer",
    borderRadius: "8px",
    overflow: "hidden",
    gap: "0.75rem",
  },
  episodeGridThumbWrap: {
    position: "relative",
    width: "240px",
    minWidth: "240px",
    aspectRatio: "16/9",
    borderRadius: "8px",
    overflow: "hidden",
    background: "var(--bg-secondary)",
    flexShrink: 0,
  },
  episodeGridThumb: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  episodeWatchedBadge: {
    position: "absolute",
    top: "6px",
    right: "6px",
    background: "rgba(0,0,0,0.75)",
    borderRadius: "50%",
    width: "28px",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--accent)",
    border: "2px solid rgba(255,255,255,0.15)",
    backdropFilter: "blur(4px)",
  },
  episodeDuration: {
    position: "absolute",
    bottom: "6px",
    right: "6px",
    background: "rgba(0,0,0,0.75)",
    color: "#fff",
    fontSize: "0.8rem",
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: "4px",
    backdropFilter: "blur(4px)",
  },
  episodeGridInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    padding: "0.25rem 0",
    overflow: "hidden",
    flex: 1,
    minWidth: 0,
  },
  episodeGridTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  episodeGridNumber: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  episodeSynopsis: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    marginTop: "0.15rem",
  },
};
