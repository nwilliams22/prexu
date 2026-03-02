import { useState } from "react";

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
}

function PosterCard({
  imageUrl,
  title,
  subtitle,
  badge,
  onClick,
  width = 160,
  aspectRatio = 1.5,
  progress,
  onContextMenu,
  showMoreButton,
  onMoreClick,
}: PosterCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);
  const height = Math.round(width * aspectRatio);

  return (
    <button
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
      }}
    >
      {/* Image container */}
      <div style={{ ...styles.imageContainer, height }}>
        {/* Skeleton shown until image loads */}
        {!loaded && <div className="shimmer" style={styles.skeleton} />}

        <img
          src={imageUrl}
          alt={title}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          style={{
            ...styles.image,
            opacity: loaded ? 1 : 0,
          }}
        />

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
            <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        )}

        {/* Badge (e.g. "+3 episodes") */}
        {badge && <span style={styles.badge}>{badge}</span>}

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
  moreButton: {
    position: "absolute",
    bottom: "6px",
    right: "6px",
    width: "28px",
    height: "28px",
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
  badge: {
    position: "absolute",
    top: "6px",
    right: "6px",
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.7rem",
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: "4px",
    whiteSpace: "nowrap",
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
    fontSize: "0.85rem",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  subtitle: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

export default PosterCard;
