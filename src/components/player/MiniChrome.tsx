/**
 * Compact chrome rendered inside the minimized player region
 * (prexu-7il.3 / .5 / .7).
 *
 * Sits absolutely-positioned inside the small corner wrapper Player.tsx
 * builds when `usePlayerSession().isMinimized` is true. Renders:
 *
 * - Top-right cluster: Restore (return to full player) + Close (stop playback).
 *   The restore button is the ONLY way to leave minimize from the chrome —
 *   we deliberately do not honor clicks on the transparent middle area.
 *   (prexu-2rz: the click-to-restore "Plex convention" produced a
 *   click-after-drag bug on shrink-resize that the recentlyDraggedAtRef
 *   guard in prexu-lhs only partially solved, since synthetic clicks
 *   often land on a chrome button rather than the root.)
 * - Bottom-center: Play/Pause transport
 * - Resize handle on the corner OPPOSITE the active anchor (7il.5).
 *   Dragging it grows/shrinks the mini player; mid-drag IPC is throttled
 *   to ~50 ms so the mpv host follows the drag without flooding
 *   sync_geometry.
 * - Drag surface covering the rest of the chrome (7il.7) — mousedown+drag
 *   from any non-button area to grab the mini player. A semi-transparent
 *   ghost previews the new position; on release we snap to the nearest
 *   of the four corners and commit via `updateMiniRect({ corner })`.
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
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampMiniSize,
  nearestCorner,
  type MiniCorner,
  type MiniRect,
} from "../../utils/mini-rect";
import { logger } from "../../services/logger";

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
}

/** Pointer-movement threshold (logical px) below which an anchor-drag
 *  mousedown→mouseup is treated as not-a-drag (no ghost, no corner
 *  commit). The root region is intentionally not clickable, so falling
 *  below the threshold is a true no-op (prexu-2rz). */
const DRAG_THRESHOLD_PX = 4;

/** Suppress the browser's default drag-selection on the page underneath
 *  while the user is dragging the mini player around. Without this the
 *  cursor crossing dashboard cards/text starts a marquee selection that
 *  highlights everything in its path. (prexu-ois) */
function lockTextSelection(): void {
  if (typeof document === "undefined") return;
  document.body.style.userSelect = "none";
  document.body.style.cursor = "grabbing";
  // Clear any selection that may have started on the very first
  // millisecond before userSelect:none kicked in.
  window.getSelection?.()?.removeAllRanges?.();
}
function unlockTextSelection(): void {
  if (typeof document === "undefined") return;
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
}

/** Throttle window for mid-drag IPC during resize. The mpv host re-snaps
 *  to the corner on every Resized event; ~20 Hz balances perceived
 *  smoothness with sync_geometry's ~50 ms minimum interval. */
const RESIZE_IPC_THROTTLE_MS = 50;

const styles = {
  root: {
    position: "absolute" as const,
    inset: 0,
    pointerEvents: "auto" as const,
    // grab → grabbing during an anchor drag. No longer "pointer" — the
    // root area is draggable but not clickable (prexu-2rz).
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
    transition: "opacity 0.2s ease",
    zIndex: 2,
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
}: MiniChromeProps) {
  // Track in-progress drag state without re-renders. State is only updated
  // when the ghost actually appears (after threshold crossed) or on commit.
  type DragKind = "anchor" | "resize" | null;
  const dragRef = useRef<{
    kind: DragKind;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startTime: number;
    moved: boolean;
    lastIpcTime: number;
  } | null>(null);

  // Visible ghost overlay state — only set once we've crossed the drag
  // threshold so sub-threshold mousedowns produce no visual artifact.
  const [ghost, setGhost] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Cancel any in-flight drag if the component unmounts mid-gesture. Window
  // listeners are added inside the mousedown handlers and torn down here.
  const cleanupListenersRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      cleanupListenersRef.current?.();
    };
  }, []);

  // ── Anchor-drag (move the mini between corners) ─────────────────────────
  const handleRegionMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only respond to primary button. Right-click / middle-click should
      // pass through to native context menus etc.
      if (e.button !== 0) return;
      // If the target is a button or the resize handle, those have their
      // own handlers; don't start an anchor drag here.
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-mini-no-drag="true"]')) return;

      // Suppress the browser's default text/marquee selection on the
      // dashboard underneath — without this, dragging the mini across
      // the Home view highlights cards and text as the cursor crosses
      // them (prexu-ois).
      e.preventDefault();
      lockTextSelection();

      onActivity();
      dragRef.current = {
        kind: "anchor",
        startX: e.clientX,
        startY: e.clientY,
        startW: miniRect.width,
        startH: miniRect.height,
        startTime: Date.now(),
        moved: false,
        lastIpcTime: 0,
      };

      // Initial ghost geometry: centred on cursor. We update it on every
      // mousemove after threshold-crossing.
      const onMove = (ev: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.kind !== "anchor") return;
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        setGhost({
          x: ev.clientX - drag.startW / 2,
          y: ev.clientY - drag.startH / 2,
          width: drag.startW,
          height: drag.startH,
        });
      };

      const onUp = (ev: MouseEvent) => {
        const drag = dragRef.current;
        dragRef.current = null;
        cleanupListenersRef.current?.();
        cleanupListenersRef.current = null;
        setGhost(null);
        unlockTextSelection();
        if (!drag) return;
        if (!drag.moved) {
          // Sub-threshold mousedown→mouseup. Nothing to commit; we
          // intentionally do NOT treat this as a restore click (prexu-2rz —
          // the restore button is the only chrome path back to full).
          return;
        }
        // Compute nearest corner. Use the cursor position as the "centre"
        // proxy because the ghost is centred on cursor for the duration
        // of the drag.
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const corner: MiniCorner = nearestCorner(
          { x: ev.clientX, y: ev.clientY },
          miniRect,
          viewportWidth,
          viewportHeight,
        );
        logger.info("player:minimize", "anchor-drag commit", {
          from: miniRect.corner,
          to: corner,
          cursor: { x: ev.clientX, y: ev.clientY },
        });
        onUpdateMiniRect({ corner });
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp, { once: true });
      cleanupListenersRef.current = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        unlockTextSelection();
      };
    },
    [miniRect, onActivity, onUpdateMiniRect],
  );

  // ── Resize-handle drag (grow/shrink the mini) ───────────────────────────
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      lockTextSelection();
      onActivity();

      dragRef.current = {
        kind: "resize",
        startX: e.clientX,
        startY: e.clientY,
        startW: miniRect.width,
        startH: miniRect.height,
        startTime: Date.now(),
        moved: true, // resize is always a drag — no click fall-through
        lastIpcTime: 0,
      };

      const anchorCorner = miniRect.corner;

      const onMove = (ev: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.kind !== "resize") return;
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        const { width, height } = nextSizeFromResize(
          drag.startW,
          drag.startH,
          dx,
          dy,
          anchorCorner,
          window.innerWidth,
          window.innerHeight,
        );
        // Throttle the React state update (and therefore the IPC) to
        // ~20 Hz. Previously both `if` and `else` called onUpdateMiniRect,
        // making the throttle a no-op — every mousemove fired a
        // playerEnterMinimize IPC + a setMiniRect re-render. The
        // setMiniRect changed AppLayout's mask-size/mask-position, which
        // forced WebView2 to re-rasterize the whole Dashboard layer; the
        // visible mask cut-out then trailed the cursor by hundreds of ms
        // even though the mpv host was following more quickly via IPC.
        //
        // With actual throttling, the mask + mpv host stay in lockstep at
        // 20 Hz. The cursor leads both by up to 50 ms but they no longer
        // drift apart visually. The final position is always committed by
        // the onUp handler below, so the last frame of the drag is never
        // lost. (prexu-vm2)
        const now = Date.now();
        if (now - drag.lastIpcTime >= RESIZE_IPC_THROTTLE_MS) {
          drag.lastIpcTime = now;
          onUpdateMiniRect({ width, height });
        }
      };

      const onUp = (ev: MouseEvent) => {
        const drag = dragRef.current;
        dragRef.current = null;
        cleanupListenersRef.current?.();
        cleanupListenersRef.current = null;
        unlockTextSelection();
        if (!drag) return;
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        const final = nextSizeFromResize(
          drag.startW,
          drag.startH,
          dx,
          dy,
          anchorCorner,
          window.innerWidth,
          window.innerHeight,
        );
        logger.info("player:minimize", "resize commit", {
          from: { w: drag.startW, h: drag.startH },
          to: final,
        });
        onUpdateMiniRect(final);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp, { once: true });
      cleanupListenersRef.current = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        unlockTextSelection();
      };
    },
    [miniRect, onActivity, onUpdateMiniRect],
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

        {/* Bottom-center: play/pause */}
        <div
          style={{
            ...styles.bottomCluster,
            opacity: visible ? 1 : 0,
            pointerEvents: visible ? "auto" : "none",
          }}
          data-testid="mini-chrome-bottom"
          data-mini-no-drag="true"
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

        {/* Resize handle — opposite the active anchor (7il.5). Drag to
            grow/shrink; live IPC throttled to ~50 ms in the mousemove
            handler so the mpv host follows without flooding sync_geometry. */}
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
