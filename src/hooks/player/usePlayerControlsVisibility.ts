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
      if (isPlaying) setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, [isPlaying]);

  const handleMouseMove = useCallback(() => {
    resetHideTimer();
  }, [resetHideTimer]);

  // React to play/pause transitions:
  // - paused: show controls and stop the hide countdown
  // - playing (including unpause without mouse movement): show controls and
  //   start a fresh 3s countdown so the user doesn't have to wiggle the mouse
  useEffect(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setControlsVisible(true);
    if (isPlaying) {
      hideTimerRef.current = setTimeout(
        () => setControlsVisible(false),
        CONTROLS_HIDE_MS,
      );
    }
  }, [isPlaying]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return { controlsVisible, resetHideTimer, handleMouseMove };
}
