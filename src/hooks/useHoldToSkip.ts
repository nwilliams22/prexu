/**
 * Hook for press-and-hold skip with acceleration.
 *
 * Tap = instant skip (10s). Hold = repeating skips that accelerate
 * from 10s up to 120s per tick.
 */

import { useRef, useCallback, useEffect } from "react";

interface UseHoldToSkipOptions {
  /** Called each tick with the skip amount in seconds */
  onSkip: (seconds: number) => void;
  /** Called each tick with a display label (e.g. "+10", "-30") */
  onSkipLabel: (label: string) => void;
  /** Skip direction — controls the label sign */
  direction: "forward" | "backward";
}

interface UseHoldToSkipResult {
  onPointerDown: () => void;
  onPointerUp: () => void;
}

const INITIAL_SKIP = 10;
const HOLD_DELAY_MS = 500;
const REPEAT_INTERVAL_MS = 400;
const ACCELERATION = 10;
const MAX_SKIP = 120;

export function useHoldToSkip({
  onSkip,
  onSkipLabel,
  direction,
}: UseHoldToSkipOptions): UseHoldToSkipResult {
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentSkipRef = useRef(INITIAL_SKIP);

  const clearTimers = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
    currentSkipRef.current = INITIAL_SKIP;
  }, []);

  // Cleanup on unmount
  useEffect(() => clearTimers, [clearTimers]);

  const makeLabel = useCallback(
    (seconds: number) =>
      direction === "forward" ? `+${seconds}` : `-${seconds}`,
    [direction],
  );

  const onPointerDown = useCallback(() => {
    // Immediate first skip
    onSkip(INITIAL_SKIP);
    onSkipLabel(makeLabel(INITIAL_SKIP));
    currentSkipRef.current = INITIAL_SKIP;

    // After hold delay, start repeating with acceleration
    holdTimerRef.current = setTimeout(() => {
      repeatTimerRef.current = setInterval(() => {
        currentSkipRef.current = Math.min(
          currentSkipRef.current + ACCELERATION,
          MAX_SKIP,
        );
        onSkip(currentSkipRef.current);
        onSkipLabel(makeLabel(currentSkipRef.current));
      }, REPEAT_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  }, [onSkip, onSkipLabel, makeLabel]);

  const onPointerUp = useCallback(() => {
    clearTimers();
  }, [clearTimers]);

  return { onPointerDown, onPointerUp };
}
