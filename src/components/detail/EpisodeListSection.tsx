import { useState } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { useBreakpoint, isMobile } from "../../hooks/useBreakpoint";
import { usePlayAction } from "../../hooks/usePlayAction";
import { decodeHtmlEntities } from "../../utils/media-helpers";
import { logger } from "../../services/logger";
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
  const { getPlayHandler, playOverlay } = usePlayAction();

  return (
    <>
      <div
        style={{
          ...styles.section,
          opacity: seasonFading ? 0 : 1,
          transition: "opacity 0.15s ease",
        }}
      >
        <h2 style={styles.sectionTitle}>
          {episodes.length} Episode{episodes.length !== 1 ? "s" : ""}
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              bp === "large" ? "1fr 1fr" : bp === "desktop" ? "1fr 1fr" : "1fr",
            gap: mobile ? "0.75rem" : "1rem",
          }}
        >
          {episodes.map((ep) => (
            <EpisodeRow
              key={ep.ratingKey}
              episode={ep}
              mobile={mobile}
              episodeThumbUrl={episodeThumbUrl}
              formatDuration={formatDuration}
              navigate={navigate}
              getPlayHandler={getPlayHandler}
            />
          ))}
        </div>
      </div>
      {playOverlay}
    </>
  );
}

interface EpisodeRowProps {
  episode: PlexEpisode;
  mobile: boolean;
  episodeThumbUrl: (path: string) => string;
  formatDuration: (ms: number) => string;
  navigate: NavigateFunction;
  getPlayHandler: ReturnType<typeof usePlayAction>["getPlayHandler"];
}

function EpisodeRow({
  episode: ep,
  mobile,
  episodeThumbUrl,
  formatDuration,
  navigate,
  getPlayHandler,
}: EpisodeRowProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const showPlayOverlay = hovered || focused;

  const viewCount = (ep as PlexEpisode & { viewCount?: number }).viewCount;
  const isWatched = viewCount != null && viewCount > 0;
  const airDate = ep.originallyAvailableAt
    ? new Date(ep.originallyAvailableAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const playHandler = getPlayHandler(ep);

  const handleThumbClick = (e: React.MouseEvent) => {
    void logger.debug("episodes", "play episode", {
      ratingKey: ep.ratingKey,
      title: ep.title,
    });
    if (playHandler) {
      playHandler(e);
      return;
    }
    e.stopPropagation();
    navigate(`/play/${ep.ratingKey}`);
  };

  const handleDetailClick = () => {
    void logger.debug("episodes", "view episode detail", {
      ratingKey: ep.ratingKey,
      title: ep.title,
    });
    navigate(`/item/${ep.ratingKey}`);
  };

  return (
    <div
      style={{
        ...styles.episodeRow,
        ...(mobile ? { flexDirection: "column" as const } : {}),
      }}
    >
      <button
        type="button"
        onClick={handleThumbClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...styles.thumbButton,
          ...(mobile ? { width: "100%", minWidth: "unset" } : {}),
        }}
        aria-label={`Play ${ep.title}`}
      >
        <img
          src={episodeThumbUrl(ep.thumb)}
          alt=""
          style={styles.episodeGridThumb}
          loading="lazy"
        />
        {isWatched && (
          <div style={styles.episodeWatchedBadge}>
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}
        {ep.duration && (
          <span style={styles.episodeDuration}>
            {formatDuration(ep.duration)}
          </span>
        )}
        <div
          aria-hidden="true"
          style={{
            ...styles.playOverlay,
            opacity: showPlayOverlay ? 1 : 0,
          }}
        >
          <svg
            width={26}
            height={26}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <polygon points="6,3 21,12 6,21" />
          </svg>
        </div>
      </button>
      <button
        type="button"
        onClick={handleDetailClick}
        style={styles.detailButton}
        aria-label={`View details for ${ep.title}`}
      >
        <span style={styles.episodeGridNumber}>
          Episode {ep.index}
          {airDate ? ` · ${airDate}` : ""}
        </span>
        <span style={styles.episodeGridTitle}>{ep.title}</span>
        {ep.summary && (
          <span style={styles.episodeSynopsis}>
            {decodeHtmlEntities(ep.summary)}
          </span>
        )}
      </button>
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
  episodeRow: {
    display: "flex",
    flexDirection: "row",
    color: "var(--text-primary)",
    textAlign: "left",
    borderRadius: "8px",
    overflow: "hidden",
    gap: "0.75rem",
  },
  thumbButton: {
    position: "relative",
    width: "240px",
    minWidth: "240px",
    aspectRatio: "16/9",
    borderRadius: "8px",
    overflow: "hidden",
    background: "var(--bg-secondary)",
    flexShrink: 0,
    padding: 0,
    border: "none",
    cursor: "pointer",
    color: "inherit",
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
  playOverlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    background: "rgba(0, 0, 0, 0.7)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    transition: "opacity 0.15s ease",
    backdropFilter: "blur(4px)",
    zIndex: 2,
  },
  detailButton: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    padding: "0.25rem 0",
    overflow: "hidden",
    flex: 1,
    minWidth: 0,
    background: "transparent",
    border: "none",
    color: "var(--text-primary)",
    textAlign: "left",
    cursor: "pointer",
    borderRadius: "8px",
  },
  episodeGridTitle: {
    fontSize: "1.1rem",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  episodeGridNumber: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
  },
  episodeSynopsis: {
    fontSize: "0.95rem",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    marginTop: "0.15rem",
  },
};
