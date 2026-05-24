/**
 * Compact chrome rendered inside the minimized player region.
 *
 * Sits absolutely-positioned inside the small corner wrapper Player.tsx
 * builds when `usePlayerSession().isMinimized` is true. Renders:
 *
 * - Top-right cluster: Restore (return to full player) + Close (stop playback).
 *   The restore button is the ONLY way to leave minimize from the chrome —
 *   we deliberately do not honor clicks on the transparent middle area.
 *   Click-to-restore produced a click-after-drag bug where synthetic clicks
 *   often land on a chrome button rather than the root, so the whole region
 *   is drag-only (no click fall-through).
 * - Bottom-center: Play/Pause transport
 * - Resize handle on the corner OPPOSITE the active anchor. Dragging it
 *   grows/shrinks the mini player; mid-drag IPC is throttled to ~50 ms so
 *   the mpv host follows without flooding sync_geometry.
 * - Drag surface covering the rest of the chrome — mousedown+drag from any
 *   non-button area to grab the mini player. A semi-transparent ghost previews
 *   the new position; on release we snap to the nearest of the four corners
 *   and commit via `updateMiniRect({ corner })`.
 *
 * Auto-hides after inactivity using the same visibility flag the main
 * chrome uses (passed in as `visible`). Mouse activity anywhere inside
 * the region resets the hide timer via `onActivity`.
 *
 * The title is shown as the native browser tooltip on the region root so
 * users can hover to confirm what's playing without taking up visible
 * pixels.
 */

import type React from "react";
import { useCallback, useRef, useState } from "react";
import {
  clampMiniSize,
  nearestCorner,
  type MiniCorner,
  type MiniRect,
} from "../../utils/mini-rect";
import { logger } from "../../services/logger";
import { useDragGesture } from "../../hooks/player/useDragGesture";

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
  /** Current mini-player rect. Drives the resize handle position + the
   *  anchor-drag snap target geometry. */
  miniRect: MiniRect;
  /** Apply a partial update to the rect. PlayerContext persists the
   *  result and resyncs the Rust mpv host while minimized. */
  onUpdateMiniRect: (updates: Partial<MiniRect>) => void;
  /** Playback position in seconds. Drives the scrub bar fill. */
  currentTime: number;
  /** Total duration in seconds. Scrub bar + skip controls hide when
   *  duration is 0 (e.g. before metadata loads). */
  duration: number;
  /** Seek to an absolute time (seconds). Should be the WT-aware variant
   *  when in a session, matching `onTogglePlay`. */
  onSeek: (seconds: number) => void;
}

/** Skip-back / skip-forward delta in seconds. */
const SKIP_SECONDS = 10;

/** Pointer-movement threshold (logical px) below which an anchor-drag
 *  mousedown→mouseup is treated as not-a-drag (no ghost, no corner
 *  commit). The root region is intentionally not clickable, so falling
 *  below the threshold is a true no-op. */
const DRAG_THRESHOLD_PX = 4;

/** Throttle window for mid-drag IPC during resize. The mpv host re-snaps
 *  to the corner on every Resized event; ~20 Hz balances perceived
 *  smoothness with sync_geometry's ~50 ms minimum interval. */
const RESIZE_IPC_THROTTLE_MS = 50;

const styles = {
  root: {
    position: "absolute" as const,
    inset: 0,
    pointerEvents: "auto" as const,
    // grab → grabbing during an anchor drag. The root area is draggable
    // but not clickable — no click fall-through by design.
    cursor: "grab",
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
    // Above the drag layer so button clicks land on the buttons rather
    // than starting a drag.
    zIndex: 2,
  },
  bottomCluster: {
    position: "absolute" as const,
    bottom: 12,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    transition: "opacity 0.2s ease",
    zIndex: 2,
  },
  scrubWrap: {
    position: "absolute" as const,
    bottom: 56,
    left: 12,
    right: 12,
    transition: "opacity 0.2s ease",
    zIndex: 2,
  },
  scrubInput: {
    width: "100%",
    height: 4,
    cursor: "pointer",
    accentColor: "white",
    background: "transparent",
    margin: 0,
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
  resizeHandleBase: {
    position: "absolute" as const,
    width: 18,
    height: 18,
    background: "rgba(0, 0, 0, 0.65)",
    border: "1px solid rgba(255, 255, 255, 0.4)",
    borderRadius: 4,
    transition: "opacity 0.2s ease",
    zIndex: 3,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
  },
  dragGhost: {
    position: "fixed" as const,
    background: "rgba(0, 0, 0, 0.55)",
    border: "2px dashed rgba(255, 255, 255, 0.7)",
    borderRadius: 8,
    pointerEvents: "none" as const,
    zIndex: 1100,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
  },
};

/** Which corner of the mini box the resize handle should live on. We
 *  always put it OPPOSITE the active anchor: pulling it grows the box
 *  AWAY from the anchor rather than INTO it (which would feel like
 *  pushing the anchor off-screen). */
function oppositeCorner(corner: MiniCorner): MiniCorner {
  switch (corner) {
    case "top-left":
      return "bottom-right";
    case "top-right":
      return "bottom-left";
    case "bottom-left":
      return "top-right";
    case "bottom-right":
    default:
      return "top-left";
  }
}

/** Positioning for the resize handle relative to the mini container. The
 *  handle sits slightly outside the corner so its full surface is
 *  hit-testable even when the underlying mpv host overlaps the edge. */
function resizeHandleStyle(corner: MiniCorner): React.CSSProperties {
  const offset = -6;
  const handleCorner = oppositeCorner(corner);
  const cursor = (() => {
    // The handle sits on `handleCorner` of the mini box — give it the
    // matching diagonal cursor. (nwse for tl↔br, nesw for tr↔bl.)
    if (handleCorner === "top-left" || handleCorner === "bottom-right") {
      return "nwse-resize";
    }
    return "nesw-resize";
  })();
  const base: React.CSSProperties = { ...styles.resizeHandleBase, cursor };
  switch (handleCorner) {
    case "top-left":
      return { ...base, top: offset, left: offset };
    case "top-right":
      return { ...base, top: offset, right: offset };
    case "bottom-left":
      return { ...base, bottom: offset, left: offset };
    case "bottom-right":
    default:
      return { ...base, bottom: offset, right: offset };
  }
}

/** Compute the new width/height when the user drags the resize handle.
 *  dx/dy are deltas relative to the drag start; sign depends on which
 *  corner the handle lives on. Returns the clamped result. */
function nextSizeFromResize(
  startW: number,
  startH: number,
  dx: number,
  dy: number,
  anchorCorner: MiniCorner,
  viewportWidth: number,
  viewportHeight: number,
): { width: number; height: number } {
  // Handle is opposite anchor: dragging away from the anchor enlarges.
  // For left-anchored corners the handle is on the right, so +dx grows.
  // For right-anchored corners the handle is on the left, so -dx grows.
  const isLeftAnchored =
    anchorCorner === "top-left" || anchorCorner === "bottom-left";
  const isTopAnchored =
    anchorCorner === "top-left" || anchorCorner === "top-right";
  const widthDelta = isLeftAnchored ? dx : -dx;
  const heightDelta = isTopAnchored ? dy : -dy;
  return clampMiniSize(
    startW + widthDelta,
    startH + heightDelta,
    viewportWidth,
    viewportHeight,
  );
}

export default function MiniChrome({
  isPlaying,
  onTogglePlay,
  onRestore,
  onClose,
  title,
  visible,
  onActivity,
  onMouseMove,
  miniRect,
  onUpdateMiniRect,
  currentTime,
  duration,
  onSeek,
}: MiniChromeProps) {
  // Scrub + skip controls only meaningful once metadata has loaded.
  const hasDuration = duration > 0;

  const seekTo = useCallback(
    (target: number) => {
      if (!hasDuration) return;
      const clamped = Math.max(0, Math.min(duration, target));
      logger.debug("player:minimize", "mini-seek", { from: currentTime, to: clamped });
      onSeek(clamped);
    },
    [currentTime, duration, hasDuration, onSeek],
  );

  const skip = useCallback(
    (delta: number) => {
      logger.debug("player:minimize", "mini-skip", {
        delta,
        from: currentTime,
      });
      seekTo(currentTime + delta);
    },
    [currentTime, seekTo],
  );

  const handleScrubChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onActivity();
      const v = Number(e.target.value);
      if (!Number.isFinite(v)) return;
      seekTo(v);
    },
    [onActivity, seekTo],
  );
  // Visible ghost overlay state — only set once we've crossed the drag
  // threshold so sub-threshold mousedowns produce no visual artifact.
  const [ghost, setGhost] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // ── Resize IPC throttle state (ref — no re-renders) ────────────────────
  const lastResizeIpcRef = useRef<number>(0);

  // ── Anchor-drag (move the mini between corners) ─────────────────────────
  // useDragGesture handles all listener bookkeeping, lockTextSelection, and
  // unmount cleanup. MiniChrome supplies the three lines of differing math.
  const getAnchorStart = useCallback(
    () => ({ width: miniRect.width, height: miniRect.height }),
    [miniRect.width, miniRect.height],
  );

  const onAnchorDragStart = useCallback(
    ({ clientX, clientY, start }: { clientX: number; clientY: number; start: { width: number; height: number } }) => {
      setGhost({
        x: clientX - start.width / 2,
        y: clientY - start.height / 2,
        width: start.width,
        height: start.height,
      });
    },
    [],
  );

  const onAnchorMove = useCallback(
    ({ clientX, clientY, start }: { clientX: number; clientY: number; start: { width: number; height: number } }) => {
      setGhost({
        x: clientX - start.width / 2,
        y: clientY - start.height / 2,
        width: start.width,
        height: start.height,
      });
    },
    [],
  );

  const onAnchorCommit = useCallback(
    ({ clientX, clientY }: { clientX: number; clientY: number }) => {
      setGhost(null);
      const corner: MiniCorner = nearestCorner(
        { x: clientX, y: clientY },
        miniRect,
        window.innerWidth,
        window.innerHeight,
      );
      logger.info("player:minimize", "anchor-drag commit", {
        from: miniRect.corner,
        to: corner,
        cursor: { x: clientX, y: clientY },
      });
      onUpdateMiniRect({ corner });
    },
    [miniRect, onUpdateMiniRect],
  );

  const onAnchorCancel = useCallback(() => {
    setGhost(null);
    // Sub-threshold mousedown→mouseup is a true no-op.
  }, []);

  const { onMouseDown: anchorOnMouseDown } = useDragGesture({
    getStart: getAnchorStart,
    threshold: DRAG_THRESHOLD_PX,
    onDragStart: onAnchorDragStart,
    onMove: onAnchorMove,
    onCommit: onAnchorCommit,
    onCancel: onAnchorCancel,
  });

  // Wrap to guard data-mini-no-drag targets and call onActivity.
  const handleRegionMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-mini-no-drag="true"]')) return;
      onActivity();
      anchorOnMouseDown(e);
    },
    [anchorOnMouseDown, onActivity],
  );

  // ── Resize-handle drag (grow/shrink the mini) ───────────────────────────
  const getResizeStart = useCallback(
    () => ({
      width: miniRect.width,
      height: miniRect.height,
      corner: miniRect.corner,
    }),
    [miniRect.width, miniRect.height, miniRect.corner],
  );

  const onResizeMove = useCallback(
    ({ dx, dy, start }: { dx: number; dy: number; start: { width: number; height: number; corner: MiniCorner } }) => {
      const { width, height } = nextSizeFromResize(
        start.width,
        start.height,
        dx,
        dy,
        start.corner,
        window.innerWidth,
        window.innerHeight,
      );
      // Throttle the React state update (and therefore the IPC) to ~20 Hz.
      // With actual throttling, the mask + mpv host stay in lockstep.
      // The final position is always committed by onResizeCommit.
      const now = Date.now();
      if (now - lastResizeIpcRef.current >= RESIZE_IPC_THROTTLE_MS) {
        lastResizeIpcRef.current = now;
        onUpdateMiniRect({ width, height });
      }
    },
    [onUpdateMiniRect],
  );

  const onResizeCommit = useCallback(
    ({ dx, dy, start }: { dx: number; dy: number; start: { width: number; height: number; corner: MiniCorner } }) => {
      const final = nextSizeFromResize(
        start.width,
        start.height,
        dx,
        dy,
        start.corner,
        window.innerWidth,
        window.innerHeight,
      );
      logger.info("player:minimize", "resize commit", {
        from: { w: start.width, h: start.height },
        to: final,
      });
      onUpdateMiniRect(final);
    },
    [onUpdateMiniRect],
  );

  const { onMouseDown: resizeOnMouseDown } = useDragGesture({
    getStart: getResizeStart,
    threshold: 0, // resize is always a drag — no click fall-through
    onMove: onResizeMove,
    onCommit: onResizeCommit,
  });

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onActivity();
      resizeOnMouseDown(e);
    },
    [resizeOnMouseDown, onActivity],
  );

  const handleButtonClick = useCallback(
    (handler: () => void) => (e: React.MouseEvent) => {
      e.stopPropagation();
      onActivity();
      handler();
    },
    [onActivity],
  );

  const handleResize = resizeHandleStyle(miniRect.corner);

  return (
    <>
      <div
        style={styles.root}
        onMouseDown={handleRegionMouseDown}
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
          data-mini-no-drag="true"
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

        {/* Scrub bar — slim range above the bottom cluster. Hidden when
            duration hasn't been reported yet (e.g. pre-metadata). The
            range input gets keyboard a11y for free. */}
        {hasDuration && (
          <div
            style={{
              ...styles.scrubWrap,
              opacity: visible ? 1 : 0,
              pointerEvents: visible ? "auto" : "none",
            }}
            data-testid="mini-chrome-scrub-wrap"
            data-mini-no-drag="true"
          >
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={Math.min(currentTime, duration)}
              onChange={handleScrubChange}
              onMouseDown={(e) => e.stopPropagation()}
              style={styles.scrubInput}
              aria-label="Seek"
              data-testid="mini-chrome-scrub"
            />
          </div>
        )}

        {/* Bottom-center: ±10s + play/pause cluster. */}
        <div
          style={{
            ...styles.bottomCluster,
            opacity: visible ? 1 : 0,
            pointerEvents: visible ? "auto" : "none",
          }}
          data-testid="mini-chrome-bottom"
          data-mini-no-drag="true"
        >
          {hasDuration && (
            <button
              type="button"
              style={styles.iconButton}
              onClick={handleButtonClick(() => skip(-SKIP_SECONDS))}
              aria-label={`Skip back ${SKIP_SECONDS} seconds`}
              title={`Back ${SKIP_SECONDS}s`}
              data-testid="mini-chrome-skip-back"
            >
              {/* Chevron-double-left */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
          )}
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
          {hasDuration && (
            <button
              type="button"
              style={styles.iconButton}
              onClick={handleButtonClick(() => skip(SKIP_SECONDS))}
              aria-label={`Skip forward ${SKIP_SECONDS} seconds`}
              title={`Forward ${SKIP_SECONDS}s`}
              data-testid="mini-chrome-skip-forward"
            >
              {/* Chevron-double-right */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="13 17 18 12 13 7" />
                <polyline points="6 17 11 12 6 7" />
              </svg>
            </button>
          )}
        </div>

        {/* Resize handle — opposite the active anchor. Drag to grow/shrink;
            live IPC throttled to ~50 ms in the mousemove handler so the
            mpv host follows without flooding sync_geometry. */}
        <div
          style={{
            ...handleResize,
            opacity: visible ? 1 : 0,
            pointerEvents: visible ? "auto" : "none",
          }}
          data-testid="mini-chrome-resize"
          data-mini-no-drag="true"
          onMouseDown={handleResizeMouseDown}
          aria-label="Resize mini player"
          role="button"
        >
          {/* Subtle diagonal grip glyph — purely decorative. */}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="2" y1="8" x2="8" y2="2" />
            <line x1="5" y1="8" x2="8" y2="5" />
          </svg>
        </div>
      </div>

      {/* Drag ghost — semi-transparent preview that follows the cursor
          while the user is moving the mini player. We do NOT reposition
          the actual mpv host live: that would fire one sync_geometry per
          mousemove and flood the Win32 message queue. The ghost is the
          full user-visible feedback until release. */}
      {ghost && (
        <div
          style={{
            ...styles.dragGhost,
            top: ghost.y,
            left: ghost.x,
            width: ghost.width,
            height: ghost.height,
          }}
          data-testid="mini-chrome-ghost"
          aria-hidden
        />
      )}
    </>
  );
}
