import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { getItemMetadata, getItemChildren, getImageUrl } from "../services/plex-library";
import type { PlexShow, PlexSeason, PlexTag } from "../types/library";

interface ShowExpansionPanelProps {
  ratingKey: string;
  onClose: () => void;
  onNavigateToShow: (ratingKey: string) => void;
  onNavigateToSeason?: (seasonRatingKey: string) => void;
}

function ShowExpansionPanel({
  ratingKey,
  onClose,
  onNavigateToShow,
  onNavigateToSeason,
}: ShowExpansionPanelProps) {
  const { server } = useAuth();
  const [show, setShow] = useState<PlexShow | null>(null);
  const [seasons, setSeasons] = useState<PlexSeason[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server) return;
    let cancelled = false;

    (async () => {
      try {
        const [data, seasonList] = await Promise.all([
          getItemMetadata<PlexShow>(server.uri, server.accessToken, ratingKey),
          getItemChildren<PlexSeason>(server.uri, server.accessToken, ratingKey),
        ]);
        if (!cancelled) {
          setShow(data);
          setSeasons(seasonList);
        }
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load show details"
          );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, ratingKey]);

  if (!server) return null;

  const posterUrl = show?.thumb
    ? getImageUrl(server.uri, server.accessToken, show.thumb, 200, 300)
    : "";

  return (
    <div style={styles.container}>
      {/* Accent top bar */}
      <div style={styles.accentBar} />

      {/* Close button */}
      <button
        onClick={onClose}
        style={styles.closeButton}
        aria-label="Collapse details"
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <line x1={18} y1={6} x2={6} y2={18} />
          <line x1={6} y1={6} x2={18} y2={18} />
        </svg>
      </button>

      {isLoading && (
        <div style={styles.loadingContainer}>
          <p style={styles.loadingText}>Loading...</p>
        </div>
      )}

      {error && (
        <div style={styles.loadingContainer}>
          <p style={styles.errorText}>{error}</p>
        </div>
      )}

      {show && !isLoading && (
        <div style={styles.content}>
          {/* Poster */}
          {posterUrl && (
            <img
              src={posterUrl}
              alt=""
              style={styles.poster}
            />
          )}

          {/* Details */}
          <div style={styles.details}>
            <h3 style={styles.title}>{show.title}</h3>

            {/* Meta row */}
            <div style={styles.metaRow}>
              {show.year && (
                <span style={styles.metaItem}>{show.year}</span>
              )}
              {show.contentRating && (
                <span style={styles.metaTag}>{show.contentRating}</span>
              )}
              {show.rating && (
                <span style={styles.metaItem}>
                  ★ {Number(show.rating).toFixed(1)}
                </span>
              )}
              {show.childCount && (
                <span style={styles.metaItem}>
                  {show.childCount} season{show.childCount !== 1 ? "s" : ""}
                </span>
              )}
              {show.leafCount && (
                <span style={styles.metaItem}>
                  {show.leafCount} episode{show.leafCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Genres */}
            {show.Genre && show.Genre.length > 0 && (
              <div style={styles.genreRow}>
                {show.Genre.map((g: PlexTag) => (
                  <span key={g.tag} style={styles.genreTag}>
                    {g.tag}
                  </span>
                ))}
              </div>
            )}

            {/* Summary */}
            {show.summary && (
              <p style={styles.summary}>{show.summary}</p>
            )}

            {/* Watch progress */}
            {show.viewedLeafCount !== undefined && show.leafCount !== undefined && show.leafCount > 0 && (
              <div style={styles.watchProgress}>
                <div style={styles.watchProgressTrack}>
                  <div
                    style={{
                      ...styles.watchProgressBar,
                      width: `${Math.min(
                        ((show.viewedLeafCount ?? 0) / show.leafCount) * 100,
                        100
                      )}%`,
                    }}
                  />
                </div>
                <span style={styles.watchProgressText}>
                  {show.viewedLeafCount ?? 0} / {show.leafCount} watched
                </span>
              </div>
            )}

            {/* Season buttons */}
            {seasons.length > 0 && onNavigateToSeason && (
              <div style={styles.seasonRow}>
                {seasons.map((season) => (
                  <button
                    key={season.ratingKey}
                    onClick={() => onNavigateToSeason(season.ratingKey)}
                    style={styles.seasonButton}
                  >
                    {season.title}
                  </button>
                ))}
              </div>
            )}

            {/* Actions */}
            <div style={styles.actions}>
              <button
                onClick={() => onNavigateToShow(ratingKey)}
                style={styles.primaryButton}
              >
                View Show
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "relative",
    background: "var(--bg-secondary)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    margin: "0.5rem 0",
    overflow: "hidden",
    animation: "slideDown 0.25s ease-out",
  },
  accentBar: {
    height: "3px",
    background: "var(--accent)",
  },
  closeButton: {
    position: "absolute",
    top: "12px",
    right: "12px",
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    background: "rgba(255,255,255,0.1)",
    color: "var(--text-secondary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    zIndex: 2,
    border: "none",
    cursor: "pointer",
  },
  loadingContainer: {
    padding: "2rem",
    textAlign: "center",
  },
  loadingText: {
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
  },
  errorText: {
    color: "var(--error)",
    fontSize: "0.9rem",
  },
  content: {
    display: "flex",
    gap: "1.25rem",
    padding: "1.25rem",
  },
  poster: {
    width: "120px",
    height: "180px",
    borderRadius: "6px",
    objectFit: "cover",
    flexShrink: 0,
  },
  details: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  title: {
    fontSize: "1.1rem",
    fontWeight: 700,
    margin: 0,
    color: "var(--text-primary)",
  },
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flexWrap: "wrap",
  },
  metaItem: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
  },
  metaTag: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "3px",
    padding: "1px 5px",
  },
  genreRow: {
    display: "flex",
    gap: "0.4rem",
    flexWrap: "wrap",
  },
  genreTag: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
    background: "rgba(255,255,255,0.05)",
    borderRadius: "3px",
    padding: "2px 6px",
  },
  summary: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    margin: 0,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  watchProgress: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  watchProgressTrack: {
    flex: 1,
    height: "4px",
    background: "rgba(255,255,255,0.1)",
    borderRadius: "2px",
    maxWidth: "200px",
  },
  watchProgressBar: {
    height: "100%",
    background: "var(--accent)",
    borderRadius: "2px",
  },
  watchProgressText: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  seasonRow: {
    display: "flex",
    gap: "0.4rem",
    flexWrap: "wrap",
  },
  seasonButton: {
    background: "rgba(255,255,255,0.08)",
    color: "var(--text-secondary)",
    fontSize: "0.75rem",
    fontWeight: 500,
    padding: "0.25rem 0.6rem",
    borderRadius: "4px",
    border: "1px solid var(--border)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background 0.1s",
  },
  actions: {
    display: "flex",
    gap: "0.5rem",
    marginTop: "0.25rem",
  },
  primaryButton: {
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "6px",
    padding: "0.4rem 1rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

export default ShowExpansionPanel;
