import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHoldToSkip } from "./useHoldToSkip";

describe("useHoldToSkip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires immediate skip of 10s on pointerDown", () => {
    const onSkip = vi.fn();
    const onSkipLabel = vi.fn();
    const { result } = renderHook(() =>
      useHoldToSkip({ onSkip, onSkipLabel, direction: "forward" })
    );

    act(() => {
      result.current.onPointerDown();
    });

    expect(onSkip).toHaveBeenCalledWith(10);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("shows correct forward label (+10)", () => {
    const onSkip = vi.fn();
    const onSkipLabel = vi.fn();
    const { result } = renderHook(() =>
      useHoldToSkip({ onSkip, onSkipLabel, direction: "forward" })
    );

    act(() => {
      result.current.onPointerDown();
    });

    expect(onSkipLabel).toHaveBeenCalledWith("+10");
  });

  it("shows correct backward label (-10)", () => {
    const onSkip = vi.fn();
    const onSkipLabel = vi.fn();
    const { result } = renderHook(() =>
      useHoldToSkip({ onSkip, onSkipLabel, direction: "backward" })
    );

    act(() => {
      result.current.onPointerDown();
    });

    expect(onSkipLabel).toHaveBeenCalledWith("-10");
  });

  it("accelerates on hold beyond 500ms", () => {
    const onSkip = vi.fn();
    const onSkipLabel = vi.fn();
    const { result } = renderHook(() =>
      useHoldToSkip({ onSkip, onSkipLabel, direction: "forward" })
    );

    act(() => {
      result.current.onPointerDown();
    });

    // Advance past hold delay (500ms) then one repeat interval (400ms)
    act(() => {
      vi.advanceTimersByTime(500 + 400);
    });

    // Initial call with 10, then accelerated call with 20
    expect(onSkip).toHaveBeenCalledWith(20);
    expect(onSkipLabel).toHaveBeenCalledWith("+20");
  });

  it("caps skip at 120 seconds", () => {
    const onSkip = vi.fn();
    const onSkipLabel = vi.fn();
    const { result } = renderHook(() =>
      useHoldToSkip({ onSkip, onSkipLabel, direction: "forward" })
    );

    act(() => {
      result.current.onPointerDown();
    });

    // Advance past hold delay + enough intervals to exceed max
    // Need 11 intervals to go from 10 -> 20 -> 30 -> ... -> 120
    // (each interval adds 10, capped at 120)
    act(() => {
      vi.advanceTimersByTime(500 + 400 * 15);
    });

    const lastSkipCall = onSkip.mock.calls[onSkip.mock.calls.length - 1][0];
    expect(lastSkipCall).toBe(120);
  });

  it("stops repeating on pointerUp", () => {
    const onSkip = vi.fn();
    const onSkipLabel = vi.fn();
    const { result } = renderHook(() =>
      useHoldToSkip({ onSkip, onSkipLabel, direction: "forward" })
    );

    act(() => {
      result.current.onPointerDown();
    });

    // Let hold start repeating
    act(() => {
      vi.advanceTimersByTime(500 + 400);
    });

    const callCountAfterHold = onSkip.mock.calls.length;

    act(() => {
      result.current.onPointerUp();
    });

    // Advance more time — no new calls should happen
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onSkip.mock.calls.length).toBe(callCountAfterHold);
  });

  it("resets skip amount on new pointerDown", () => {
    const onSkip = vi.fn();
    const onSkipLabel = vi.fn();
    const { result } = renderHook(() =>
      useHoldToSkip({ onSkip, onSkipLabel, direction: "forward" })
    );

    // First press and hold to accelerate
    act(() => {
      result.current.onPointerDown();
    });
    act(() => {
      vi.advanceTimersByTime(500 + 400);
    });
    act(() => {
      result.current.onPointerUp();
    });

    onSkip.mockClear();
    onSkipLabel.mockClear();

    // Second press should start at 10 again
    act(() => {
      result.current.onPointerDown();
    });

    expect(onSkip).toHaveBeenCalledWith(10);
    expect(onSkipLabel).toHaveBeenCalledWith("+10");
  });

  it("cleans up timers on unmount", () => {
    const onSkip = vi.fn();
    const onSkipLabel = vi.fn();
    const { result, unmount } = renderHook(() =>
      useHoldToSkip({ onSkip, onSkipLabel, direction: "forward" })
    );

    act(() => {
      result.current.onPointerDown();
    });

    const callCountBeforeUnmount = onSkip.mock.calls.length;

    unmount();

    // Advance time — no more calls should fire
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onSkip.mock.calls.length).toBe(callCountBeforeUnmount);
  });
});
