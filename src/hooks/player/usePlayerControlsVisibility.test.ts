import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  usePlayerControlsVisibility,
  MOUSE_ACTIVITY_THRESHOLD_PX,
} from "./usePlayerControlsVisibility";
import { logger } from "../../services/logger";

vi.mock("../../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

describe("usePlayerControlsVisibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Wrapped in act: flushing a pending hide-timer fires setControlsVisible
    // — without act this emits "update not wrapped in act" warnings for any
    // test that ends with the timer still armed.
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it("shows controls by default", () => {
    const { result } = renderHook(() => usePlayerControlsVisibility(true));
    expect(result.current.controlsVisible).toBe(true);
  });

  it("hides controls after 3s of inactivity while playing", () => {
    const { result } = renderHook(() => usePlayerControlsVisibility(true));
    expect(result.current.controlsVisible).toBe(true);

    // Fast-forward 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.controlsVisible).toBe(false);
  });

  it("hides controls after 3s of inactivity while paused", () => {
    const { result } = renderHook(() => usePlayerControlsVisibility(false));
    expect(result.current.controlsVisible).toBe(true);

    // Fast-forward 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.controlsVisible).toBe(false);
  });

  it("shows controls again on mouse move while paused", () => {
    const { result } = renderHook(() => usePlayerControlsVisibility(false));

    // Fast-forward 3 seconds to hide controls
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.controlsVisible).toBe(false);

    // Move mouse to restore visibility
    act(() => {
      result.current.handleMouseMove({ clientX: 100, clientY: 100 });
    });
    expect(result.current.controlsVisible).toBe(true);

    // Advance time but not 3s yet
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.controlsVisible).toBe(true);

    // After full 3s from mouse move, hide again
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.controlsVisible).toBe(false);
  });

  it("restarts the timer on resetHideTimer call while paused", () => {
    const { result } = renderHook(() => usePlayerControlsVisibility(false));

    // Advance 2.5 seconds (not enough to hide)
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(result.current.controlsVisible).toBe(true);

    // Call resetHideTimer (simulating user input)
    act(() => {
      result.current.resetHideTimer();
    });

    // Advance 2 more seconds (total 4.5, but only 2 since reset)
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.controlsVisible).toBe(true);

    // After 3s from reset, should hide
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.controlsVisible).toBe(false);
  });

  it("shows controls when transitioning from playing to paused", () => {
    const { result, rerender } = renderHook(
      ({ isPlaying }) => usePlayerControlsVisibility(isPlaying),
      { initialProps: { isPlaying: true } }
    );

    // Hide controls while playing
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.controlsVisible).toBe(false);

    // Transition to paused
    act(() => {
      rerender({ isPlaying: false });
    });

    // Controls should be visible again
    expect(result.current.controlsVisible).toBe(true);
  });

  it("shows controls when transitioning from paused to playing", () => {
    const { result, rerender } = renderHook(
      ({ isPlaying }) => usePlayerControlsVisibility(isPlaying),
      { initialProps: { isPlaying: false } }
    );

    // Hide controls while paused
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.controlsVisible).toBe(false);

    // Transition to playing
    act(() => {
      rerender({ isPlaying: true });
    });

    // Controls should be visible again
    expect(result.current.controlsVisible).toBe(true);
  });

  it("cleans up timers on unmount", () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const { unmount } = renderHook(() => usePlayerControlsVisibility(true));

    act(() => {
      unmount();
    });

    // clearTimeout should have been called for cleanup
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("does not accumulate timers on multiple resets", () => {
    const { result } = renderHook(() => usePlayerControlsVisibility(false));

    // Reset multiple times
    act(() => {
      result.current.resetHideTimer();
      result.current.resetHideTimer();
      result.current.resetHideTimer();
    });

    // Advance 3 seconds and verify it hides only once
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.controlsVisible).toBe(false);

    // Should not have multiple pending timers trying to hide
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.controlsVisible).toBe(false);
  });

  // ── Synthetic/jittering-mousemove guard (prexu-axj4.4 Linux defect) ──────
  // Engines (WebKitGTK on Linux especially) dispatch mousemove events when
  // layout changes under a stationary cursor. During native playback the
  // seek bar re-renders at 4 Hz, producing a steady stream of these moves —
  // which, pre-fix, each reset the hide timer so the controls never
  // auto-hid. On-hardware testing further showed the coordinates of these
  // events can JITTER by a px or two under Wayland (fractional-scale
  // rounding / relayout recomputation), so the guard is a displacement
  // threshold from the last accepted position, not exact equality.
  describe("synthetic mousemove guard", () => {
    it("hides controls despite repeated mousemove events at identical coordinates (4 Hz synthetic storm)", () => {
      const { result } = renderHook(() => usePlayerControlsVisibility(true));
      expect(result.current.controlsVisible).toBe(true);

      // Simulate 3.5s of playback with a stationary cursor: every 250ms the
      // engine re-dispatches mousemove at the same position. Pre-fix, every
      // event reset the 3s timer and this assertion failed (controls stayed
      // visible forever).
      for (let i = 0; i < 14; i++) {
        act(() => {
          vi.advanceTimersByTime(250);
          result.current.handleMouseMove({ clientX: 640, clientY: 360 });
        });
      }

      expect(result.current.controlsVisible).toBe(false);
    });

    it("hides controls despite a 4 Hz storm with JITTERING sub-threshold coordinates (Wayland dither)", () => {
      const { result } = renderHook(() => usePlayerControlsVisibility(true));
      expect(result.current.controlsVisible).toBe(true);

      // The on-hardware failure mode after the exact-equality guard: every
      // synthetic event arrives at a slightly different position, dithering
      // ±2px around the true pointer location. Under equality-only guarding
      // each event re-armed the timer and this assertion failed.
      const jitter = [
        { dx: 0, dy: 0 },
        { dx: 1, dy: -1 },
        { dx: -1, dy: 1 },
        { dx: 2, dy: 0 },
        { dx: 0, dy: 2 },
        { dx: -2, dy: -1 },
        { dx: 1, dy: 1 },
      ];
      for (let i = 0; i < 14; i++) {
        const j = jitter[i % jitter.length]!;
        act(() => {
          vi.advanceTimersByTime(250);
          result.current.handleMouseMove({
            clientX: 640 + j.dx,
            clientY: 360 + j.dy,
          });
        });
      }

      expect(result.current.controlsVisible).toBe(false);
    });

    it("treats deliberate movement beyond the threshold as genuine activity", () => {
      const { result } = renderHook(() => usePlayerControlsVisibility(true));

      // Hide via idle timeout first (anchor parked at 100,100).
      act(() => {
        result.current.handleMouseMove({ clientX: 100, clientY: 100 });
        vi.advanceTimersByTime(3000);
      });
      expect(result.current.controlsVisible).toBe(false);

      // Real displacement (>= threshold) — controls come back.
      act(() => {
        result.current.handleMouseMove({
          clientX: 100 + MOUSE_ACTIVITY_THRESHOLD_PX,
          clientY: 100,
        });
      });
      expect(result.current.controlsVisible).toBe(true);

      // A follow-up jitter storm around the NEW position must not keep them
      // alive: hide 3s after the last genuine move.
      for (let i = 0; i < 12; i++) {
        act(() => {
          vi.advanceTimersByTime(250);
          result.current.handleMouseMove({
            clientX: 100 + MOUSE_ACTIVITY_THRESHOLD_PX + (i % 2),
            clientY: 100 + (i % 3) - 1,
          });
        });
      }
      expect(result.current.controlsVisible).toBe(false);
    });

    it("slow deliberate movement ACCUMULATES against the anchor and is not eaten by the threshold", () => {
      const { result } = renderHook(() => usePlayerControlsVisibility(true));

      // Park the anchor, hide the controls.
      act(() => {
        result.current.handleMouseMove({ clientX: 200, clientY: 200 });
        vi.advanceTimersByTime(3000);
      });
      expect(result.current.controlsVisible).toBe(false);

      // The user drags slowly toward the controls: 2px per event, one
      // direction. Individually each step is sub-threshold, but distance
      // from the anchor accumulates (2, 4, 6...) — the third step crosses
      // the 5px threshold and MUST re-show the chrome. A per-event
      // (anchor-follows-every-move) guard would eat this forever.
      act(() => {
        result.current.handleMouseMove({ clientX: 202, clientY: 200 });
      });
      expect(result.current.controlsVisible).toBe(false);
      act(() => {
        result.current.handleMouseMove({ clientX: 204, clientY: 200 });
      });
      expect(result.current.controlsVisible).toBe(false);
      act(() => {
        result.current.handleMouseMove({ clientX: 206, clientY: 200 });
      });
      expect(result.current.controlsVisible).toBe(true);
    });

    it("the first mousemove after mount counts as genuine (no previous position)", () => {
      const { result } = renderHook(() => usePlayerControlsVisibility(true));

      // Let the mount-armed timer hide the controls.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(result.current.controlsVisible).toBe(false);

      // Very first pointer event of the session restores visibility even
      // though there's nothing to diff against.
      act(() => {
        result.current.handleMouseMove({ clientX: 5, clientY: 5 });
      });
      expect(result.current.controlsVisible).toBe(true);
    });

    it("resetHideTimer (discrete gestures: clicks, keys) still resets unconditionally", () => {
      const { result } = renderHook(() => usePlayerControlsVisibility(true));

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(result.current.controlsVisible).toBe(false);

      // A key press / click at a stationary cursor is real activity even
      // with zero pointer displacement — must keep bypassing the guard.
      act(() => {
        result.current.resetHideTimer();
      });
      expect(result.current.controlsVisible).toBe(true);
    });
  });

  // ── TEMPORARY diagnostic logging (prexu-axj4.4, keep-or-strip) ───────────
  describe("diagnostic re-arm attribution logging", () => {
    it("logs the re-arm reason for mousemove, explicit, and transition paths", () => {
      const { result, rerender } = renderHook(
        ({ isPlaying }) => usePlayerControlsVisibility(isPlaying),
        { initialProps: { isPlaying: true } },
      );

      // Mount fires the isPlaying-transition arm.
      expect(logger.debug).toHaveBeenCalledWith(
        "player",
        "controls-visibility re-arm (isPlaying-transition)",
        { isPlaying: true },
      );

      act(() => {
        result.current.handleMouseMove({ clientX: 10, clientY: 10 });
      });
      expect(logger.debug).toHaveBeenCalledWith(
        "player",
        "controls-visibility re-arm (mousemove-first)",
        undefined,
      );

      act(() => {
        result.current.handleMouseMove({ clientX: 30, clientY: 10 });
      });
      expect(logger.debug).toHaveBeenCalledWith(
        "player",
        "controls-visibility re-arm (mousemove)",
        { displacement: 20 },
      );

      act(() => {
        result.current.resetHideTimer();
      });
      expect(logger.debug).toHaveBeenCalledWith(
        "player",
        "controls-visibility re-arm (explicit)",
        undefined,
      );

      act(() => {
        rerender({ isPlaying: false });
      });
      expect(logger.debug).toHaveBeenCalledWith(
        "player",
        "controls-visibility re-arm (isPlaying-transition)",
        { isPlaying: false },
      );
    });

    it("logs ignored sub-threshold moves at trace with the measured displacement", () => {
      const { result } = renderHook(() => usePlayerControlsVisibility(true));

      act(() => {
        result.current.handleMouseMove({ clientX: 100, clientY: 100 });
        result.current.handleMouseMove({ clientX: 101, clientY: 100 });
      });

      expect(logger.trace).toHaveBeenCalledWith(
        "player",
        "controls-visibility mousemove ignored (below threshold)",
        { displacement: 1 },
      );
    });

    it("logs when the auto-hide actually fires", () => {
      renderHook(() => usePlayerControlsVisibility(true));

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(logger.debug).toHaveBeenCalledWith(
        "player",
        "controls-visibility auto-hide fired",
      );
    });
  });
});
