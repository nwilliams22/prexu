/**
 * Hook encapsulating seek bar interaction logic — mouse drag,
 * touch drag, hover tooltip position, and progress percentages.
 *
 * Drag-time seeks are throttled (leading + trailing, 150ms window) so a
 * fast scrub doesn't fire 30+ Tauri invokes/second. Each seek triggers a
 * Plex transcode segment fetch + mpv decode restart, so unthrottled drags
 * stack redundant work (see prexu-v2h). The pointer-up release always
 * fires a final, un-throttled seek to land exactly where the user stopped.
 *
 * The thumb shows the live drag position via `dragTime` so the user gets
 * immediate visual feedback even when the underlying playback time hasn't
 * caught up yet.
 *
 * Keyboard shortcuts (arrow seeks) bypass this hook entirely — they call
 * `seek` directly from the player keybindings layer, one invocation per
 * key press, no debounce needed.
 */

import { useState, useRef, useCallback, useEffect } from "react";

const SEEK_THROTTLE_MS = 150;

export interface UseSeekBarOptions {
  duration: number;
  currentTime: number;
  buffered: number;
  seek: (time: number) => void;
  onActivity?: () => void;
}

export interface UseSeekBarResult {
  seekBarRef: React.RefObject<HTMLDivElement | null>;
  isDragging: boolean;
  hoverTime: number | null;
  hoverX: number;
  progressPercent: number;
  bufferedPercent: number;
  clearHover: () => void;
  handleSeekMouseDown: (e: React.MouseEvent) => void;
  handleSeekHover: (e: React.MouseEvent) => void;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: () => void;
}

export function useSeekBar({
  duration,
  currentTime,
  buffered,
  seek,
  onActivity,
}: UseSeekBarOptions): UseSeekBarResult {
  const seekBarRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState<number | null>(null);

  // Throttle bookkeeping for drag-time seeks. Refs because we don't want
  // identity changes to invalidate the drag handlers (which are recreated
  // anew on each mousedown anyway, but rebuilding the throttle state mid-drag
  // would defeat the purpose).
  const lastSeekAtRef = useRef<number>(0);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const trailingTimerRef = useRef<number | null>(null);

  // Pixel-perfect display: when dragging, show the user's pointer position
  // even if backend time hasn't caught up yet. Otherwise track real time.
  const effectiveTime = dragTime ?? currentTime;
  const progressPercent = duration > 0 ? (effectiveTime / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;

  const clearTrailingTimer = useCallback(() => {
    if (trailingTimerRef.current !== null) {
      window.clearTimeout(trailingTimerRef.current);
      trailingTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount: cancel any pending throttle timer.
  useEffect(() => {
    return () => {
      clearTrailingTimer();
    };
  }, [clearTrailingTimer]);

  const performSeek = useCallback(
    (time: number) => {
      lastSeekAtRef.current = performance.now();
      pendingSeekTimeRef.current = null;
      seek(time);
    },
    [seek],
  );

  const throttledDragSeek = useCallback(
    (time: number) => {
      pendingSeekTimeRef.current = time;
      const now = performance.now();
      const sinceLast = now - lastSeekAtRef.current;
      if (sinceLast >= SEEK_THROTTLE_MS) {
        clearTrailingTimer();
        performSeek(time);
        return;
      }
      if (trailingTimerRef.current !== null) return;
      const wait = SEEK_THROTTLE_MS - sinceLast;
      trailingTimerRef.current = window.setTimeout(() => {
        trailingTimerRef.current = null;
        const target = pendingSeekTimeRef.current;
        if (target !== null) performSeek(target);
      }, wait);
    },
    [clearTrailingTimer, performSeek],
  );

  const getSeekTime = useCallback(
    (clientX: number): number => {
      const bar = seekBarRef.current;
      if (!bar) return 0;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  const handleSeekMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      onActivity?.();
      const time = getSeekTime(e.clientX);
      setDragTime(time);
      // Leading-edge: fire one seek immediately so the click registers.
      performSeek(time);

      const handleMouseMove = (ev: MouseEvent) => {
        const t = getSeekTime(ev.clientX);
        setDragTime(t);
        throttledDragSeek(t);
      };
      const handleMouseUp = (ev: MouseEvent) => {
        const t = getSeekTime(ev.clientX);
        // Cancel any pending trailing timer; pointer-up always commits.
        clearTrailingTimer();
        performSeek(t);
        setDragTime(null);
        setIsDragging(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [getSeekTime, onActivity, performSeek, throttledDragSeek, clearTrailingTimer],
  );

  const handleSeekHover = useCallback(
    (e: React.MouseEvent) => {
      const time = getSeekTime(e.clientX);
      setHoverTime(time);
      const bar = seekBarRef.current;
      if (bar) {
        const rect = bar.getBoundingClientRect();
        setHoverX(e.clientX - rect.left);
      }
    },
    [getSeekTime],
  );

  const clearHover = useCallback(() => setHoverTime(null), []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      setIsDragging(true);
      onActivity?.();
      const time = getSeekTime(e.touches[0].clientX);
      setDragTime(time);
      performSeek(time);
    },
    [getSeekTime, onActivity, performSeek],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      // isDragging check not needed — touchmove only fires after touchstart
      const t = getSeekTime(e.touches[0].clientX);
      setDragTime(t);
      throttledDragSeek(t);
    },
    [getSeekTime, throttledDragSeek],
  );

  const handleTouchEnd = useCallback(() => {
    clearTrailingTimer();
    // If the user lifted between throttle windows, the latest target may
    // not have been committed yet — flush it now so the seek lands where
    // the finger stopped.
    if (pendingSeekTimeRef.current !== null) {
      performSeek(pendingSeekTimeRef.current);
    }
    setDragTime(null);
    setIsDragging(false);
  }, [clearTrailingTimer, performSeek]);

  return {
    seekBarRef,
    isDragging,
    hoverTime,
    hoverX,
    progressPercent,
    bufferedPercent,
    clearHover,
    handleSeekMouseDown,
    handleSeekHover,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
