/**
 * Hook encapsulating seek bar interaction logic — mouse drag,
 * touch drag, hover tooltip position, and progress percentages.
 */

import { useState, useRef, useCallback } from "react";

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

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;

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
      seek(time);

      const handleMouseMove = (ev: MouseEvent) => {
        seek(getSeekTime(ev.clientX));
      };
      const handleMouseUp = (ev: MouseEvent) => {
        seek(getSeekTime(ev.clientX));
        setIsDragging(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [getSeekTime, seek, onActivity],
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
      seek(getSeekTime(e.touches[0].clientX));
    },
    [getSeekTime, seek, onActivity],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      // isDragging check not needed — touchmove only fires after touchstart
      seek(getSeekTime(e.touches[0].clientX));
    },
    [getSeekTime, seek],
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

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
