/**
 * Compact chrome rendered inside the minimized player region (prexu-7il.3).
 *
 * Sits absolutely-positioned inside the small bottom-right wrapper Player.tsx
 * builds when `usePlayerSession().isMinimized` is true. Renders:
 *
 * - Top-right cluster: Restore (return to full player) + Close (stop playback)
 * - Bottom-center: Play/Pause transport
 *
 * Auto-hides after inactivity using the same visibility flag the main chrome
 * uses (passed in as `visible`). The transparent middle area treats a click
 * as "restore to full player" per Plex web convention. Mouse activity
 * anywhere inside the region resets the hide timer via `onActivity`.
 *
 * The title is shown as the native browser tooltip on the region root so
 * users can hover to confirm what's playing without taking up visible
 * pixels.
 */

import type React from "react";
import { useCallback } from "react";

interface MiniChromeProps {
  /** True when playback is unpaused; toggles the play vs pause icon. */
  isPlaying: boolean;
  /** Toggle play/pause. Should be the WT-aware variant when in a session. */
  onTogglePlay: () => void;
  /** Return to full-screen player layout. Wired to PlayerContext.restoreFromMinimize. */
  onRestore: () => void;
  /** Close the player (full teardown). Wired to Player.tsx's handleExit. */
  onClose: () => void;
  /** Current item title; shown as native hover tooltip. Optional. */
  title?: string;
  /** True when chrome should be opaque; false fades it out (auto-hide). */
  visible: boolean;
  /** Called on any meaningful interaction so the visibility timer resets. */
  onActivity: () => void;
  /** Forwarded to the region's `onMouseMove` so the visibility hook can
   *  reset its hide timer (matches the main player's hook). */
  onMouseMove: (e: React.MouseEvent) => void;
}

const styles = {
  root: {
    position: "absolute" as const,
    inset: 0,
    pointerEvents: "auto" as const,
    cursor: "pointer",
  },
  topCluster: {
    position: "absolute" as const,
    top: 8,
    right: 8,
    display: "flex",
    gap: 4,
    background: "rgba(0, 0, 0, 0.55)",
    borderRadius: 6,
    padding: 4,
    transition: "opacity 0.2s ease",
  },
  bottomCluster: {
    position: "absolute" as const,
    bottom: 12,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    transition: "opacity 0.2s ease",
  },
  iconButton: {
    background: "rgba(0, 0, 0, 0.55)",
    border: "none",
    borderRadius: 999,
    width: 36,
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: "white",
    padding: 0,
  },
  smallIconButton: {
    background: "transparent",
    border: "none",
    borderRadius: 4,
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: "white",
    padding: 0,
  },
};

export default function MiniChrome({
  isPlaying,
  onTogglePlay,
  onRestore,
  onClose,
  title,
  visible,
  onActivity,
  onMouseMove,
}: MiniChromeProps) {
  // Click on the transparent middle area = restore (Plex convention).
  // Clicks on the chrome buttons call stopPropagation so they don't bubble
  // here.
  const handleRegionClick = useCallback(() => {
    onActivity();
    onRestore();
  }, [onActivity, onRestore]);

  const handleButtonClick = useCallback(
    (handler: () => void) => (e: React.MouseEvent) => {
      e.stopPropagation();
      onActivity();
      handler();
    },
    [onActivity],
  );

  return (
    <div
      style={styles.root}
      onClick={handleRegionClick}
      onMouseMove={onMouseMove}
      title={title}
      data-testid="mini-chrome"
    >
      {/* Top-right: restore + close */}
      <div
        style={{
          ...styles.topCluster,
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
        }}
        data-testid="mini-chrome-top"
      >
        <button
          type="button"
          style={styles.smallIconButton}
          onClick={handleButtonClick(onRestore)}
          aria-label="Restore to full player"
          title="Restore"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
        <button
          type="button"
          style={styles.smallIconButton}
          onClick={handleButtonClick(onClose)}
          aria-label="Close player"
          title="Close"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Bottom-center: play/pause */}
      <div
        style={{
          ...styles.bottomCluster,
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
        }}
        data-testid="mini-chrome-bottom"
      >
        <button
          type="button"
          style={styles.iconButton}
          onClick={handleButtonClick(onTogglePlay)}
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
