/**
 * Inline expansion panel for grouped recently-added episodes.
 * Rendered below the "Recently Added" HorizontalRow on the Dashboard
 * when a user clicks a show-group card.
 */

import { useState, useEffect } from "react";
import { getImageUrl, getItemChildren } from "../services/plex-library";
import type { GroupedRecentItem, PlexEpisode, PlexSeason } from "../types/library";

interface EpisodeExpanderProps {
  group: GroupedRecentItem;
  serverUri: string;
  serverToken: string;
  onClose: () => void;
  onPlayEpisode: (ratingKey: string) => void;
  onViewShow: (groupKey: string) => void;
  onViewEpisode: (ratingKey: string) => void;
  closing?: boolean;
}

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function EpisodeExpander({
  group,
  serverUri,
  serverToken,
  onClose,
  onPlayEpisode,
  onViewShow,
  onViewEpisode,
  closing,
}: EpisodeExpanderProps) {
  const [fetchedEpisodes, setFetchedEpisodes] = useState<PlexEpisode[]>([]);
  const [isFetchingEpisodes, setIsFetchingEpisodes] = useState(false);
  const [seasons, setSeasons] = useState<PlexSeason[]>([]);

  // Escape key closes the panel
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // When group.episodes is empty (season-based data), fetch seasons + episodes
  useEffect(() => {
    if (group.episodes.length > 0) return;
    if (!serverUri || !serverToken || !group.groupKey) return;
    let cancelled = false;

    (async () => {
      setIsFetchingEpisodes(true);
      try {
        // Fetch seasons for this show
        const seasonList = await getItemChildren<PlexSeason>(
          serverUri,
          serverToken,
          group.groupKey
        );
        if (cancelled) return;
        setSeasons(seasonList);

        // Fetch episodes from each season that was recently added
        const targetSeasons = group.seasonIndices.length > 0
          ? seasonList.filter((s) => group.seasonIndices.includes(s.index))
          : seasonList;

        const episodePromises = targetSeasons.map((season) =>
          getItemChildren<PlexEpisode>(serverUri, serverToken, season.ratingKey)
        );
        const results = await Promise.all(episodePromises);
        if (!cancelled) {
          setFetchedEpisodes(results.flat());
        }
      } catch {
        // Silently fail — header and View Show link still work
      } finally {
        if (!cancelled) setIsFetchingEpisodes(false);
      }
    })();

    return () => { cancelled = true; };
  }, [serverUri, serverToken, group.groupKey, group.episodes.length, group.seasonIndices]);

  // Use provided episodes or fetched ones
  const allEpisodes = group.episodes.length > 0 ? group.episodes : fetchedEpisodes;

  // Sort episodes by season then episode number
  const sortedEpisodes = [...allEpisodes].sort((a, b) => {
    if (a.parentIndex !== b.parentIndex) return a.parentIndex - b.parentIndex;
    return a.index - b.index;
  });

  const episodeThumbUrl = (thumb: string) =>
    getImageUrl(serverUri, serverToken, thumb, 400, 225);

  return (
    <div style={{
      ...styles.container,
      ...(closing ? styles.containerClosing : {}),
    }}>
      {/* Header */}
      <div style={styles.header}>
        <h4 style={styles.showTitle}>{group.title}</h4>
        <div style={styles.headerActions}>
          <button
            onClick={() => onViewShow(group.groupKey)}
            style={styles.viewShowLink}
          >
            View Show
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              style={{ marginLeft: "4px" }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button
            onClick={onClose}
            style={styles.closeButton}
            aria-label="Close episode list"
          >
            <svg
              width={18}
              height={18}
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
      </div>

      {/* Season buttons */}
      {seasons.length > 0 && (
        <div style={styles.seasonRow}>
          {seasons.map((season) => (
            <button
              key={season.ratingKey}
              onClick={() => onViewEpisode(season.ratingKey)}
              style={styles.seasonButton}
            >
              {season.title}
            </button>
          ))}
        </div>
      )}

      {/* Loading indicator for fetched episodes */}
      {isFetchingEpisodes && (
        <div style={styles.fetchingContainer}>
          <div className="loading-spinner" />
        </div>
      )}

      {/* Episode list */}
      <div style={styles.episodeList}>
        {sortedEpisodes.map((ep) => (
          <div key={ep.ratingKey} style={styles.episodeRow}>
            {/* Clickable episode info area */}
            <button
              onClick={() => onViewEpisode(ep.ratingKey)}
              style={styles.episodeClickArea}
            >
              <img
                src={episodeThumbUrl(ep.thumb)}
                alt={ep.title}
                style={styles.episodeThumb}
                loading="lazy"
              />
              <div style={styles.episodeInfo}>
                <span style={styles.episodeNumber}>
                  S{String(ep.parentIndex).padStart(2, "0")}E
                  {String(ep.index).padStart(2, "0")}
                </span>
                <span style={styles.episodeTitle}>{ep.title}</span>
                <div style={styles.episodeMeta}>
                  {ep.originallyAvailableAt && (
                    <span>{ep.originallyAvailableAt}</span>
                  )}
                  {ep.duration && <span>{formatDuration(ep.duration)}</span>}
                </div>
              </div>
            </button>

            {/* Play button */}
            <button
              onClick={() => onPlayEpisode(ep.ratingKey)}
              style={styles.playButton}
              aria-label={`Play ${ep.title}`}
            >
              <svg
                width={20}
                height={20}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <polygon points="6,4 20,12 6,20" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderTop: "2px solid var(--accent)",
    borderRadius: "0 0 8px 8px",
    margin: "0 1.25rem 1rem",
    overflow: "hidden",
    animation: "slideDown 0.3s ease-out",
  },
  containerClosing: {
    animation: "none",
    maxHeight: "0px",
    opacity: 0,
    transition: "max-height 0.25s ease-in, opacity 0.2s ease-in",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.75rem 1rem",
    borderBottom: "1px solid var(--border)",
  },
  showTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: 0,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  viewShowLink: {
    background: "transparent",
    color: "var(--accent)",
    fontSize: "0.85rem",
    fontWeight: 500,
    padding: "0.25rem 0.5rem",
    borderRadius: "4px",
    display: "flex",
    alignItems: "center",
  },
  closeButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    padding: "0.25rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "4px",
  },

  seasonRow: {
    display: "flex",
    gap: "0.4rem",
    padding: "0.5rem 1rem",
    overflowX: "auto",
    borderBottom: "1px solid var(--border)",
  },
  seasonButton: {
    background: "var(--bg-card)",
    color: "var(--text-secondary)",
    fontSize: "0.8rem",
    fontWeight: 500,
    padding: "0.3rem 0.75rem",
    borderRadius: "4px",
    border: "1px solid var(--border)",
    whiteSpace: "nowrap",
    flexShrink: 0,
    cursor: "pointer",
  },
  fetchingContainer: {
    display: "flex",
    justifyContent: "center",
    padding: "1rem",
  },

  // Episode list
  episodeList: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    maxHeight: "400px",
    overflowY: "auto",
  },
  episodeRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 1rem",
    background: "var(--bg-card)",
  },
  episodeClickArea: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flex: 1,
    background: "transparent",
    color: "var(--text-primary)",
    padding: 0,
    textAlign: "left",
    overflow: "hidden",
    borderRadius: "4px",
  },
  episodeThumb: {
    width: "140px",
    height: "79px",
    borderRadius: "4px",
    objectFit: "cover",
    flexShrink: 0,
    background: "var(--bg-secondary)",
  },
  episodeInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    overflow: "hidden",
    flex: 1,
  },
  episodeNumber: {
    fontSize: "0.75rem",
    color: "var(--accent)",
    fontWeight: 600,
  },
  episodeTitle: {
    fontSize: "0.9rem",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  episodeMeta: {
    display: "flex",
    gap: "0.75rem",
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  playButton: {
    background: "var(--accent)",
    color: "#000",
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 0,
  },
};

export default EpisodeExpander;
