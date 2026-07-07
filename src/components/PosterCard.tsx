import { useState, useRef, useEffect, useCallback, memo } from "react";
import { useIsScanning } from "../hooks/useServerActivity";
import { useLazyImage } from "../hooks/useLazyImage";
import type { MediaBadge } from "../utils/media-badges";

interface PosterCardProps {
  imageUrl: string;
  /** Tiny low-quality image URL for blur-up placeholder */
  placeholderUrl?: string;
  /** Responsive srcSet for multiple resolutions */
  srcSet?: string;
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
  /** Sibling index inside a shelf / grid. Drives a staggered fade-in
   *  (prexu-yhg) — each tile's cardEnter animation is delayed by
   *  `min(index, MAX_STAGGER_INDEX) * STAGGER_STEP_MS`. Omit at
   *  call sites that aren't in a horizontal row (single-poster
   *  contexts like hero) so the default 0ms delay is preserved. */
  index?: number;
  /** Called with `ratingKey` after sustained (~150ms) hover or keyboard
   *  focus — the hover-intent prefetch hook (prexu-0szx.15). Only wire
   *  this at call sites whose onClick routes to the /item/ detail page;
   *  collection/playlist cards must leave it unset. Requires `ratingKey`. */
  onHoverIntent?: (ratingKey: string) => void;
}

/** Stagger window for the cardEnter fade-in. Tiles beyond
 *  MAX_STAGGER_INDEX all share the cap — keeps the last visible tile
 *  on a long shelf from feeling perceptibly slower than the first. */
const STAGGER_STEP_MS = 30;
const MAX_STAGGER_INDEX = 8;

/** Sustained hover/focus duration before onHoverIntent fires — long enough
 *  that sweeping the cursor across a shelf doesn't fan out prefetches, short
 *  enough to beat the hover→click gap it exists to hide. */
const HOVER_INTENT_DELAY_MS = 150;

function PosterCard({
  imageUrl,
  placeholderUrl,
  srcSet,
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
  index,
  onHoverIntent,
}: PosterCardProps) {
  const staggerDelayMs =
    index === undefined
      ? 0
      : Math.min(Math.max(0, index), MAX_STAGGER_INDEX) * STAGGER_STEP_MS;
  // Narrow per-key subscription (prexu-bgz.15): re-renders this card only
  // when ITS scanning state flips, not on every server-activity change.
  const isScanningFromServer = useIsScanning(ratingKey);
  const scanning = scanningProp ?? isScanningFromServer;
  const {
    containerRef,
    imgRef,
    shouldLoad,
    isLoaded,
    hasError: imgError,
    placeholderLoaded,
    onLoad: onLazyLoad,
    onError: onLazyError,
    onPlaceholderLoad,
  } = useLazyImage();
  const loaded = isLoaded || imgError;

  // Ref callbacks for the cache-complete race (prexu-kijk): a browser-cached
  // image can finish loading synchronously while its <img> node is still
  // being created/inserted — before React's event delegation is wired up
  // for that node — so the native 'load' event fires and is never observed,
  // and the `onLoad` prop never runs. That leaves `loaded`/`placeholderLoaded`
  // stuck false forever, so the blurred placeholder (or skeleton) never
  // clears even though the image is already fully available. Ref callbacks
  // fire during React's commit phase as soon as each node exists — earlier
  // than a passive `useEffect` — so checking `complete`/`naturalWidth` there
  // catches an already-resolved image immediately instead of waiting on an
  // event that already happened. The onLoad/onError props below are kept
  // unchanged for the normal (not-yet-cached) path.
  const setFullResImgNode = useCallback(
    (node: HTMLImageElement | null) => {
      imgRef.current = node;
      if (node && node.complete) {
        if (node.naturalWidth > 0) {
          onLazyLoad();
        } else {
          onLazyError();
        }
      }
    },
    [imgRef, onLazyLoad, onLazyError],
  );

  const setPlaceholderImgNode = useCallback(
    (node: HTMLImageElement | null) => {
      if (node && node.complete && node.naturalWidth > 0) {
        onPlaceholderLoad();
      }
    },
    [onPlaceholderLoad],
  );

  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);
  const [playHovered, setPlayHovered] = useState(false);
  const height = Math.round(width * aspectRatio);

  // Hover-intent prefetch timer (prexu-0szx.15). Latest props go through
  // refs so the timer callback never fires with a stale onHoverIntent.
  const hoverIntentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverIntentRef = useRef(onHoverIntent);
  hoverIntentRef.current = onHoverIntent;
  const ratingKeyRef = useRef(ratingKey);
  ratingKeyRef.current = ratingKey;

  const armHoverIntent = () => {
    if (!hoverIntentRef.current || !ratingKeyRef.current) return;
    if (hoverIntentTimerRef.current !== null) return; // already armed
    hoverIntentTimerRef.current = setTimeout(() => {
      hoverIntentTimerRef.current = null;
      const key = ratingKeyRef.current;
      if (key) hoverIntentRef.current?.(key);
    }, HOVER_INTENT_DELAY_MS);
  };

  const cancelHoverIntent = () => {
    if (hoverIntentTimerRef.current !== null) {
      clearTimeout(hoverIntentTimerRef.current);
      hoverIntentTimerRef.current = null;
    }
  };

  // Clear a pending intent timer on unmount (virtualized rows unmount
  // mid-scroll constantly — a fired prefetch for a card that scrolled
  // away is wasted bandwidth).
  useEffect(() => cancelHoverIntent, []);

  return (
    // <div role="button"> — not a real <button>. The card contains
    // nested action buttons (More options, Play, Expand) and the HTML
    // spec forbids <button> inside <button>. Browsers DOM-fixup by
    // hoisting the inner buttons out, breaking React's reconciler and
    // (in WebView2) eventually crashing the renderer with OOM as React
    // thrashes re-rendering. role + tabIndex + onKeyDown preserve
    // keyboard activation and accessibility tree presence. (prexu-9l3)
    <div
      className="card-enter"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        // Match native <button> activation: Enter and Space fire onClick.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(e);
        }
      }}
      onMouseEnter={() => {
        setHovered(true);
        armHoverIntent();
      }}
      onMouseLeave={() => {
        setHovered(false);
        setActive(false);
        cancelHoverIntent();
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      onFocus={armHoverIntent}
      onBlur={cancelHoverIntent}
      style={{
        ...styles.card,
        width,
        cursor: "pointer",
        willChange: hovered ? "transform" : undefined,
        transform: active ? "scale(1.0)" : hovered ? "scale(1.04)" : "scale(1)",
        border: isExpanded
          ? "2px solid var(--accent)"
          : onExpand
            ? "2px solid transparent"
            : undefined,
        // animation-delay layers onto the .card-enter keyframe defined
        // in styles.css. 0ms when no index given so legacy call sites
        // are unchanged.
        animationDelay: staggerDelayMs > 0 ? `${staggerDelayMs}ms` : undefined,
      }}
    >
      {/* Image container */}
      <div ref={containerRef} style={{ ...styles.imageContainer, height }}>
        {/* Skeleton shown until placeholder or image loads */}
        {!loaded && !placeholderLoaded && (
          <div className="shimmer" style={styles.skeleton} />
        )}

        {/* Blur-up placeholder: tiny image with CSS blur */}
        {placeholderUrl && !loaded && (
          <img
            src={placeholderUrl}
            alt=""
            ref={setPlaceholderImgNode}
            onLoad={onPlaceholderLoad}
            style={{
              ...styles.image,
              ...styles.placeholder,
              opacity: placeholderLoaded ? 1 : 0,
            }}
          />
        )}

        {shouldLoad && (
          <img
            ref={setFullResImgNode}
            src={imageUrl}
            srcSet={srcSet || undefined}
            sizes={srcSet ? `${width}px` : undefined}
            alt=""
            onLoad={onLazyLoad}
            onError={onLazyError}
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
    </div>
  );
}

/**
 * Explicit memo comparator (prexu-tqnq).
 *
 * PosterCard used to rely on React.memo's implicit default (bare
 * `memo(PosterCard)`, no second argument), which shallow-compares every
 * key React finds on the props object. That happens to be correct today,
 * but it's an easy thing to regress: the very next perf pass that adds a
 * hand-rolled comparator (as PR #47 did for other memoized components in
 * this codebase — see CollectionDetail's `ItemRow`) can trivially forget a
 * watch-state field like `progress`/`watched`/`unwatchedCount` and silently
 * stop repainting the card when a deck item's viewOffset updates in place
 * (same ratingKey, fresh cache data) — the dashboard state would be
 * correct while the card never re-renders to reflect it.
 *
 * Making the comparator explicit and exhaustively typed closes that hole:
 * `COMPARED_PROP_KEYS` is a `Record<keyof PosterCardProps, true>`, so
 * adding a new prop to `PosterCardProps` without adding it here is a
 * TypeScript compile error, not a silent runtime gap. The comparison
 * itself is intentionally equivalent to React's own default (Object.is
 * per key) — this is a documentation + compile-time-safety change, not a
 * behavior change.
 */
const COMPARED_PROP_KEYS: Record<keyof PosterCardProps, true> = {
  imageUrl: true,
  placeholderUrl: true,
  srcSet: true,
  title: true,
  subtitle: true,
  badge: true,
  onClick: true,
  width: true,
  aspectRatio: true,
  progress: true,
  onContextMenu: true,
  showMoreButton: true,
  onMoreClick: true,
  watched: true,
  unwatchedCount: true,
  onExpand: true,
  isExpanded: true,
  onPlay: true,
  scanning: true,
  ratingKey: true,
  mediaBadges: true,
  index: true,
  onHoverIntent: true,
};
const COMPARED_KEYS = Object.keys(COMPARED_PROP_KEYS) as (keyof PosterCardProps)[];

function arePropsEqual(prev: PosterCardProps, next: PosterCardProps): boolean {
  for (const key of COMPARED_KEYS) {
    if (!Object.is(prev[key], next[key])) return false;
  }
  return true;
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
    contentVisibility: "auto",
  } as React.CSSProperties,
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
  placeholder: {
    position: "absolute",
    inset: 0,
    filter: "blur(20px)",
    transform: "scale(1.1)",
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
    right: "6px",
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

export default memo(PosterCard, arePropsEqual);
