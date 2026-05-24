/**
 * Generic mouse drag gesture hook used by MiniChrome for both anchor-drag
 * (move the mini player between corners) and resize-drag (grow/shrink it).
 *
 * Owns:
 * - window mousemove + mouseup listener add/remove
 * - lockTextSelection / unlockTextSelection bracketing
 * - cleanup on component unmount mid-gesture
 *
 * Callers supply getStart() to snapshot their own state at mousedown, then
 * receive typed DragMoveInfo objects in onDragStart / onMove / onCommit.
 */

import { useCallback, useEffect, useRef } from "react";
import { logger } from "../../services/logger";

// ── Text-selection helpers ────────────────────────────────────────────────────

/** Suppress browser marquee-selection while the user is dragging. (prexu-ois) */
function lockTextSelection(): void {
  if (typeof document === "undefined") return;
  document.body.style.userSelect = "none";
  document.body.style.cursor = "grabbing";
  window.getSelection?.()?.removeAllRanges?.();
}

function unlockTextSelection(): void {
  if (typeof document === "undefined") return;
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface DragContext<T> {
  startX: number;
  startY: number;
  /** Caller-supplied "start state" snapshot (e.g. { width, height }). */
  start: T;
}

export interface DragMoveInfo<T> extends DragContext<T> {
  /** Current cursor position. */
  clientX: number;
  clientY: number;
  /** Delta from start. */
  dx: number;
  dy: number;
}

export interface UseDragGestureOptions<T> {
  /** Snapshot caller-owned state at mousedown (e.g. starting size). */
  getStart: () => T;
  /** Pixel distance below which the gesture is treated as not-a-drag.
   *  0 means every mousedown→mousemove is a drag. */
  threshold?: number;
  /** Called for every mousemove AFTER threshold is crossed. Use for live
   *  preview (ghost overlay, throttled IPC, etc.). */
  onMove?: (info: DragMoveInfo<T>) => void;
  /** Called on mouseup IF threshold was crossed. */
  onCommit?: (info: DragMoveInfo<T>) => void;
  /** Called on mouseup when threshold was NOT crossed (the sub-threshold
   *  no-op case). Defaults to no-op. */
  onCancel?: () => void;
  /** Fired exactly once when the threshold is first crossed.
   *  MiniChrome uses this to seed the ghost overlay. */
  onDragStart?: (info: DragMoveInfo<T>) => void;
}

export interface UseDragGestureResult {
  /** Spread on the element that initiates the drag. */
  onMouseDown: (e: React.MouseEvent) => void;
}

// ── Internal drag state stored in a ref (no re-renders mid-gesture) ───────────

interface DragState<T> {
  startX: number;
  startY: number;
  start: T;
  moved: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDragGesture<T>(
  options: UseDragGestureOptions<T>,
): UseDragGestureResult {
  const {
    getStart,
    threshold = 0,
    onMove,
    onCommit,
    onCancel,
    onDragStart,
  } = options;

  // Active drag state — mutated in-place to avoid re-renders during gestures.
  const dragRef = useRef<DragState<T> | null>(null);
  // Stored so the unmount cleanup effect can tear down window listeners.
  const cleanupRef = useRef<(() => void) | null>(null);

  // Tear down any in-flight gesture on unmount.
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only respond to primary button.
      if (e.button !== 0) return;

      // Suppress browser text selection / drag artefacts on the content under
      // the mini player.
      e.preventDefault();
      lockTextSelection();

      const start = getStart();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        start,
        moved: false,
      };

      logger.debug("player:drag", "drag-gesture mousedown", {
        startX: e.clientX,
        startY: e.clientY,
      });

      /** Build a DragMoveInfo from an explicit drag snapshot + the current
       *  mouse event. Does NOT read dragRef so it is safe to call after the
       *  ref has been cleared (e.g. inside handleUp). */
      const buildInfoFrom = (
        snap: DragState<T>,
        ev: MouseEvent,
      ): DragMoveInfo<T> => ({
        startX: snap.startX,
        startY: snap.startY,
        start: snap.start,
        clientX: ev.clientX,
        clientY: ev.clientY,
        dx: ev.clientX - snap.startX,
        dy: ev.clientY - snap.startY,
      });

      const handleMove = (ev: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        if (!drag.moved) {
          if (Math.hypot(dx, dy) < threshold) return;
          drag.moved = true;
          logger.debug("player:drag", "drag-gesture threshold crossed", {
            dx,
            dy,
          });
          onDragStart?.(buildInfoFrom(drag, ev));
        }
        onMove?.(buildInfoFrom(drag, ev));
      };

      const handleUp = (ev: MouseEvent) => {
        const drag = dragRef.current;
        dragRef.current = null;
        cleanupRef.current?.();
        cleanupRef.current = null;
        unlockTextSelection();
        if (!drag) return;
        if (!drag.moved) {
          logger.debug("player:drag", "drag-gesture cancelled (sub-threshold)");
          onCancel?.();
          return;
        }
        const info = buildInfoFrom(drag, ev);
        logger.debug("player:drag", "drag-gesture commit", {
          dx: info.dx,
          dy: info.dy,
        });
        onCommit?.(info);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp, { once: true });
      cleanupRef.current = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        unlockTextSelection();
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getStart, threshold, onMove, onCommit, onCancel, onDragStart],
  );

  return { onMouseDown };
}
