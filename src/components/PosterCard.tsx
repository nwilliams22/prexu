import { useState, memo } from "react";
import { useServerActivity } from "../hooks/useServerActivity";
import { useLazyImage } from "../hooks/useLazyImage";
import type { MediaBadge } from "../utils/media-badges";

interface PosterCardProps {
  imageUrl: string;
  title: string;
  subtitle?: string;
  badge?: string;
  onClick?: () => void;
  width?: number;
  aspectRatio?: number; // height / width, default 1.5 (2:3 poster)
  /** Optional progress bar (0-1) for continue watching */
  progress?: number;
  /** Right-click handler for context menu */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Show a three-dot menu button on hover */
  showMoreButton?: boolean;
  /** Click handler for the three-dot button */
  onMoreClick?: (e: React.MouseEvent) => void;
  /** Show a watched checkmark (top-right corner fold) */
  watched?: boolean;
  /** Show unwatched episode count badge (top-left) */
  unwatchedCount?: number;
  /** Callback when expand arrow is clicked (bottom center, appears on hover) */
  onExpand?: () => void;
  /** Whether this card is currently expanded (rotates arrow) */
  isExpanded?: boolean;
  /** Play button click handler — shows centered play button on hover */
  onPlay?: (e: React.MouseEvent) => void;
  /** Show a scanning/refreshing sweep animation overlay */
  scanning?: boolean;
  /** Item ratingKey — used to auto-detect scanning state from server activity */
  ratingKey?: string;
  /** Media quality badges (4K, HDR, Atmos, etc.) shown at bottom-left */
  mediaBadges?: MediaBadge[];
}

function PosterCard({
  imageUrl,
  title,
  subtitle,
  badge,
  onClick,
  width = 190,
  aspectRatio = 1.5,
  progress,
  onContextMenu,
  showMoreButton,
  onMoreClick,
  watched,
  unwatchedCount,
  onExpand,
  isExpanded,
  onPlay,
  scanning: scanningProp,
  ratingKey,
  mediaBadges,
}: PosterCardProps) {
  const { scanningIds } = useServerActivity();
  const scanning = scanningProp ?? (ratingKey ? scanningIds.has(ratingKey) : false);
  const { containerRef, shouldLoad, onLoad: onLazyLoad, onError: onLazyError } = useLazyImage();
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);
  const [playHovered, setPlayHovered] = useState(false);
  const height = Math.round(width * aspectRatio);

  return (
    <button
      className="card-enter"
      onClick={onClick}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(e);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        ...styles.card,
        width,
        transform: active ? "scale(1.0)" : hovered ? "scale(1.04)" : "scale(1)",
        border: isExpanded
          ? "2px solid var(--accent)"
          : onExpand
            ? "2px solid transparent"
            : undefined,
      }}
    >
      {/* Image container */}
      <div ref={containerRef} style={{ ...styles.imageContainer, height }}>
        {/* Skeleton shown until image loads */}
        {!loaded && <div className="shimmer" style={styles.skeleton} />}

        {shouldLoad && (
          <img
            src={imageUrl}
            alt=""
            onLoad={() => { setLoaded(true); onLazyLoad(); }}
            onError={() => { setLoaded(true); onLazyError(); }}
            style={{
              ...styles.image,
              opacity: loaded ? 1 : 0,
            }}
          />
        )}

        {/* Three-dot menu button */}
        {showMoreButton && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoreClick?.(e);
            }}
            style={{
              ...styles.moreButton,
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? "auto" : "none",
            }}
            aria-label="More options"
          >
            <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        )}

        {/* Play button (center, shown on hover when onPlay provided) */}
        {onPlay && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlay(e);
            }}
            onMouseEnter={() => setPlayHovered(true)}
            onMouseLeave={() => setPlayHovered(false)}
            style={{
              ...styles.playOverlay,
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? "auto" : "none",
              transform: playHovered
                ? "translate(-50%, -50%) scale(1.15)"
                : "translate(-50%, -50%)",
              background: playHovered
                ? "var(--accent)"
                : "rgba(0, 0, 0, 0.7)",
              color: playHovered ? "#000" : "#fff",
            }}
            aria-label="Play"
          >
            <svg aria-hidden="true" width={22} height={22} viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,3 21,12 6,21" />
            </svg>
          </button>
        )}

        {/* Expand button (bottom center, shown on hover when onExpand provided) */}
        {onExpand && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExpand();
            }}
            style={{
              ...styles.expandButton,
              opacity: hovered || isExpanded ? 1 : 0,
              pointerEvents: hovered || isExpanded ? "auto" : "none",
              transform: `translateX(-50%)${isExpanded ? " rotate(180deg)" : ""}`,
            }}
            aria-label={isExpanded ? "Collapse details" : "Expand details"}
          >
            <svg aria-hidden="true" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}

        {/* Unwatched episode count (top-left) */}
        {unwatchedCount !== undefined && unwatchedCount > 0 && (
          <span style={styles.unwatchedBadge} aria-label={`${unwatchedCount} unwatched`}>
            {unwatchedCount}
          </span>
        )}

        {/* Badge (e.g. "+3 episodes") */}
        {badge && <span style={styles.badge}>{badge}</span>}

        {/* Watched checkmark (circular badge, top-right) */}
        {watched && (
          <div style={styles.watchedBadge} aria-label="Watched">
            <svg
              aria-hidden="true"
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

        {/* Media quality badges (4K, HDR, Atmos, etc.) */}
        {mediaBadges && mediaBadges.length > 0 && (
          <div style={styles.mediaBadgeRow}>
            {mediaBadges.map((b) => (
              <span
                key={b.label}
                style={{
                  ...styles.mediaBadge,
                  ...(b.type === "hdr" ? styles.mediaBadgeHdr : {}),
                }}
              >
                {b.label}
              </span>
            ))}
          </div>
        )}

        {/* Progress bar */}
        {progress !== undefined && progress > 0 && (
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressBar,
                width: `${Math.min(progress * 100, 100)}%`,
              }}
            />
          </div>
        )}

        {/* Scanning/refreshing overlay */}
        {scanning && <div className="scan-overlay" />}
      </div>

      {/* Text below image */}
      <div style={styles.textContainer}>
        <span style={styles.title}>{title}</span>
        {subtitle && <span style={styles.subtitle}>{subtitle}</span>}
      </div>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    flexDirection: "column",
    background: "transparent",
    color: "var(--text-primary)",
    padding: 0,
    borderRadius: "8px",
    overflow: "visible",
    transition: "transform 0.15s ease",
    willChange: "transform",
    textAlign: "left",
    flexShrink: 0,
  },
  imageContainer: {
    position: "relative",
    width: "100%",
    borderRadius: "8px",
    overflow: "hidden",
    background: "var(--bg-card)",
  },
  skeleton: {
    position: "absolute",
    inset: 0,
    borderRadius: "8px",
  },
  image: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transition: "opacity 0.3s ease",
    display: "block",
  },
  playOverlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "52px",
    height: "52px",
    borderRadius: "50%",
    background: "rgba(0, 0, 0, 0.7)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    zIndex: 3,
    border: "none",
    cursor: "pointer",
    transition: "opacity 0.15s ease, transform 0.2s ease, background 0.2s ease, color 0.2s ease",
    backdropFilter: "blur(4px)",
  },
  moreButton: {
    position: "absolute",
    bottom: "6px",
    right: "6px",
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "rgba(0, 0, 0, 0.7)",
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    zIndex: 2,
    border: "none",
    cursor: "pointer",
    transition: "opacity 0.15s ease",
  },
  expandButton: {
    position: "absolute",
    bottom: "6px",
    left: "50%",
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "rgba(0, 0, 0, 0.7)",
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    zIndex: 2,
    border: "none",
    cursor: "pointer",
    transition: "opacity 0.15s ease, transform 0.2s ease",
  },
  badge: {
    position: "absolute",
    top: "6px",
    right: "6px",
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.8rem",
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: "4px",
    whiteSpace: "nowrap",
  },
  unwatchedBadge: {
    position: "absolute",
    top: "6px",
    left: "6px",
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.65rem",
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: "4px",
    whiteSpace: "nowrap",
    zIndex: 2,
  },
  watchedBadge: {
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
    zIndex: 3,
  },
  mediaBadgeRow: {
    position: "absolute",
    bottom: "8px",
    left: "6px",
    display: "flex",
    gap: "3px",
    zIndex: 2,
    pointerEvents: "none",
  },
  mediaBadge: {
    fontSize: "0.6rem",
    fontWeight: 700,
    padding: "1px 5px",
    borderRadius: "3px",
    background: "rgba(0, 0, 0, 0.75)",
    color: "rgba(255, 255, 255, 0.9)",
    backdropFilter: "blur(4px)",
    letterSpacing: "0.02em",
    lineHeight: "1.4",
    textTransform: "uppercase" as const,
  },
  mediaBadgeHdr: {
    background: "rgba(229, 160, 13, 0.85)",
    color: "#000",
  },
  progressTrack: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "5px",
    background: "rgba(255,255,255,0.2)",
  },
  progressBar: {
    height: "100%",
    background: "var(--accent)",
    borderRadius: "0 2px 2px 0",
  },
  textContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "0.4rem 0.15rem 0",
    overflow: "hidden",
  },
  title: {
    fontSize: "0.95rem",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  subtitle: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

export default memo(PosterCard);
