/**
 * Controls auto-hide logic for the video player.
 * Shows controls on genuine pointer movement, hides after inactivity.
 *
 * "Genuine" matters (prexu-axj4.4 Linux smoke tests): browsers dispatch
 * synthetic `mousemove` events — without the user touching the mouse — to
 * revalidate hover state when layout changes underneath a stationary
 * cursor. WebKitGTK (the Tauri webview on Linux) does this aggressively;
 * during playback the seek bar's progress width changes on every 4 Hz
 * time-pos tick, so a cursor parked anywhere over the player produced a
 * steady synthetic-mousemove stream that reset the hide timer forever —
 * the chrome never auto-hid on Linux native. WebView2/Chromium on Windows
 * doesn't emit repaint-driven moves the same way, which is why the
 * Windows path never showed the bug.
 *
 * On-hardware testing showed an exact-equality coordinate guard was NOT
 * sufficient: under Wayland the synthetic/regenerated events can arrive
 * with slightly DIFFERING coordinates (fractional-scale rounding,
 * compositor jitter, WebKitGTK recomputing positions per relayout). So
 * the guard is displacement-based: pointer movement only counts as
 * activity once it strays at least MOUSE_ACTIVITY_THRESHOLD_PX from the
 * position of the last ACCEPTED move (the anchor). Anchor-based
 * accumulation means slow-but-deliberate movement still triggers (each
 * event adds to the distance from the anchor until the threshold is
 * crossed) while bounded sub-threshold jitter around a stationary point
 * never does. Discrete gestures (clicks, keys, seek-bar drags) keep
 * resetting through `resetHideTimer`, which stays unconditional.
 *
 * TEMPORARY DIAGNOSTIC LOGGING (prexu-axj4.4, keep-or-strip at review):
 * every timer re-arm logs its reason at debug — grep for
 * "controls-visibility" — so an on-hardware session can attribute any
 * residual chrome pinning in one look:
 *   [player] controls-visibility re-arm (mousemove) {"displacement":12}
 *   [player] controls-visibility re-arm (mousemove-first)
 *   [player] controls-visibility re-arm (isPlaying-transition) {"isPlaying":true}
 *   [player] controls-visibility re-arm (explicit)
 *   [player] controls-visibility auto-hide fired
 * Sub-threshold moves log at trace (4 Hz-class noise per conventions):
 *   [player] controls-visibility mousemove ignored (below threshold) {"displacement":1.4}
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { logger } from "../../services/logger";

const CONTROLS_HIDE_MS = 3000;

/**
 * Minimum distance (px) the pointer must stray from the last accepted
 * position before a mousemove counts as user activity. Deliberate
 * "reach for the controls" gestures travel tens-to-hundreds of px, so
 * 5px is imperceptible to a real user; Wayland fractional-scale /
 * relayout jitter is expected to stay within a couple of px of the true
 * pointer position (the trace log above records real displacements so
 * this can be tuned from on-hardware logs). Exported for tests.
 */
export const MOUSE_ACTIVITY_THRESHOLD_PX = 5;

/** The slice of a mouse event the visibility hook needs — viewport-relative
 *  pointer coordinates. Structural subset of both DOM MouseEvent and
 *  React.MouseEvent so either can be passed straight through. */
export interface PointerPosition {
  clientX: number;
  clientY: number;
}

export interface ControlsVisibilityResult {
  controlsVisible: boolean;
  resetHideTimer: () => void;
  /** Wire to `onMouseMove`. The event parameter is REQUIRED so callers
   *  can't silently drop the coordinates the jitter guard needs. */
  handleMouseMove: (e: PointerPosition) => void;
}

export function usePlayerControlsVisibility(
  isPlaying: boolean
): ControlsVisibilityResult {
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Position of the last ACCEPTED (timer-re-arming) mousemove. clientX/
  // clientY are viewport-relative, so layout changes under a stationary
  // cursor should not change them — but on Wayland/WebKitGTK the reported
  // coordinates can jitter by a px or two, hence the displacement
  // threshold rather than exact equality. Null until the first move.
  const anchorRef = useRef<PointerPosition | null>(null);

  // Single owner of "show + start the 3s countdown". `reason`/`data` feed
  // the TEMPORARY diagnostic logging described in the module docblock.
  const armHideTimer = useCallback(
    (reason: string, data?: Record<string, unknown>) => {
      logger.debug("player", `controls-visibility re-arm (${reason})`, data);
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        logger.debug("player", "controls-visibility auto-hide fired");
        setControlsVisible(false);
      }, CONTROLS_HIDE_MS);
    },
    [],
  );

  const resetHideTimer = useCallback(() => {
    // Discrete gestures (clicks, key presses, seek-bar drags): always
    // genuine activity, no jitter guard.
    armHideTimer("explicit");
  }, [armHideTimer]);

  const handleMouseMove = useCallback(
    (e: PointerPosition) => {
      const anchor = anchorRef.current;
      if (anchor === null) {
        // First pointer event of the session — nothing to diff against;
        // treat as genuine and establish the anchor.
        anchorRef.current = { clientX: e.clientX, clientY: e.clientY };
        armHideTimer("mousemove-first");
        return;
      }
      const displacement = Math.hypot(
        e.clientX - anchor.clientX,
        e.clientY - anchor.clientY,
      );
      if (displacement < MOUSE_ACTIVITY_THRESHOLD_PX) {
        // Synthetic / jittering mousemove (layout changed under a
        // stationary cursor, compositor coordinate dither — see the
        // module docblock). Not user activity; don't re-arm. The anchor
        // deliberately does NOT move, so slow deliberate movement keeps
        // accumulating distance and eventually crosses the threshold.
        logger.trace("player", "controls-visibility mousemove ignored (below threshold)", {
          displacement: Math.round(displacement * 10) / 10,
        });
        return;
      }
      anchorRef.current = { clientX: e.clientX, clientY: e.clientY };
      armHideTimer("mousemove", { displacement: Math.round(displacement) });
    },
    [armHideTimer],
  );

  // React to play/pause transitions:
  // - Always show controls and start a fresh 3s countdown
  // - This applies whether playing or paused
  //
  // NOTE (prexu-axj4.4 diagnostics): on the native path isPlaying is fed
  // by `player://paused` events. If the Rust side ever emits alternating
  // pause values (e.g. around buffering), each alternation re-fires this
  // effect and pins the chrome — the "isPlaying-transition" re-arm log
  // exists precisely to catch that in on-hardware logs.
  useEffect(() => {
    armHideTimer("isPlaying-transition", { isPlaying });
  }, [isPlaying, armHideTimer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return { controlsVisible, resetHideTimer, handleMouseMove };
}
