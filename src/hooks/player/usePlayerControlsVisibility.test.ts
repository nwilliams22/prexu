import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePlayerControlsVisibility } from "./usePlayerControlsVisibility";

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
    vi.runOnlyPendingTimers();
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
      result.current.handleMouseMove();
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
});
