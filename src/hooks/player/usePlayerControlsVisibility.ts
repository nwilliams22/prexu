/**
 * Controls auto-hide logic for the video player.
 * Shows controls on mouse movement, hides after inactivity.
 */

import { useState, useRef, useEffect, useCallback } from "react";

const CONTROLS_HIDE_MS = 3000;

export interface ControlsVisibilityResult {
  controlsVisible: boolean;
  resetHideTimer: () => void;
  handleMouseMove: () => void;
}

export function usePlayerControlsVisibility(
  isPlaying: boolean
): ControlsVisibilityResult {
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, []);

  const handleMouseMove = useCallback(() => {
    resetHideTimer();
  }, [resetHideTimer]);

  // React to play/pause transitions:
  // - Always show controls and start a fresh 3s countdown
  // - This applies whether playing or paused
  useEffect(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setControlsVisible(true);
    hideTimerRef.current = setTimeout(
      () => setControlsVisible(false),
      CONTROLS_HIDE_MS,
    );
  }, [isPlaying]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return { controlsVisible, resetHideTimer, handleMouseMove };
}
