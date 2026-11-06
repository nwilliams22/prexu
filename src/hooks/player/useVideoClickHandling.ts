/**
 * Single-click (play/pause) vs double-click (fullscreen) detection for the video element.
 */

import { useRef, useEffect, useCallback } from "react";

const DOUBLE_CLICK_MS = 250;

export function useVideoClickHandling(
  togglePlay: () => void,
  toggleFullscreen: () => void,
  resetHideTimer: () => void,
): () => void {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  return useCallback(() => {
    if (clickTimerRef.current !== null) {
      // Restore the optimistic first click before entering fullscreen.
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      togglePlay();
      toggleFullscreen();
    } else {
      togglePlay();
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
      }, DOUBLE_CLICK_MS);
    }
    resetHideTimer();
  }, [togglePlay, toggleFullscreen, resetHideTimer]);
}
