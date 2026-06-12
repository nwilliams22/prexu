import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSeekBar } from "./useSeekBar";

function attachFakeBar(
  refHolder: { seekBarRef: React.RefObject<HTMLDivElement | null> },
  width = 100,
) {
  const el = document.createElement("div");
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: 20,
      width,
      height: 20,
      x: 0,
      y: 0,
      toJSON() {
        /* noop */
      },
    }),
  });
  // Cast through unknown to mutate the ref's `current` from the test.
  (refHolder.seekBarRef as unknown as { current: HTMLDivElement | null }).current = el;
  return el;
}

describe("useSeekBar drag throttle (prexu-v2h)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a leading seek on mousedown", () => {
    const seek = vi.fn();
    const { result } = renderHook(() =>
      useSeekBar({ duration: 100, currentTime: 0, buffered: 0, seek }),
    );
    attachFakeBar(result.current);

    act(() => {
      result.current.handleSeekMouseDown({
        preventDefault: () => {},
        clientX: 25,
      } as unknown as React.MouseEvent);
    });

    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenLastCalledWith(25);
  });

  it("collapses fast drag-time seeks within the 150ms window", () => {
    const seek = vi.fn();
    const { result } = renderHook(() =>
      useSeekBar({ duration: 100, currentTime: 0, buffered: 0, seek }),
    );
    attachFakeBar(result.current);

    act(() => {
      result.current.handleSeekMouseDown({
        preventDefault: () => {},
        clientX: 10,
      } as unknown as React.MouseEvent);
    });
    expect(seek).toHaveBeenCalledTimes(1);

    // Three rapid moves all within 60ms total — none of them should fire
    // immediately because the leading seek already fired at t=0.
    act(() => {
      vi.advanceTimersByTime(20);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 30 }));
    });
    act(() => {
      vi.advanceTimersByTime(20);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 40 }));
    });
    act(() => {
      vi.advanceTimersByTime(20);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50 }));
    });
    expect(seek).toHaveBeenCalledTimes(1);

    // Advance past the throttle window — trailing flush fires with the LAST
    // pointer position, not any of the intermediates.
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(seek).toHaveBeenCalledTimes(2);
    expect(seek).toHaveBeenLastCalledWith(50);

    // Pointer-up always commits, regardless of throttle state.
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 60 }));
    });
    expect(seek).toHaveBeenCalledTimes(3);
    expect(seek).toHaveBeenLastCalledWith(60);
  });

  it("commits a final mouseup seek even when no trailing flush is pending", () => {
    const seek = vi.fn();
    const { result } = renderHook(() =>
      useSeekBar({ duration: 100, currentTime: 0, buffered: 0, seek }),
    );
    attachFakeBar(result.current);

    act(() => {
      result.current.handleSeekMouseDown({
        preventDefault: () => {},
        clientX: 10,
      } as unknown as React.MouseEvent);
    });
    // Wait long enough that the leading window expired without any moves.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // mouseup fires final seek even if it's at a new spot.
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 75 }));
    });
    expect(seek).toHaveBeenLastCalledWith(75);
  });

  it("dragTime overrides currentTime for progressPercent during drag", () => {
    const seek = vi.fn();
    const { result } = renderHook(() =>
      useSeekBar({ duration: 100, currentTime: 10, buffered: 0, seek }),
    );
    attachFakeBar(result.current);
    expect(result.current.progressPercent).toBe(10);

    act(() => {
      result.current.handleSeekMouseDown({
        preventDefault: () => {},
        clientX: 80,
      } as unknown as React.MouseEvent);
    });
    // Thumb tracks the drag pointer (80%) even though currentTime is still 10.
    expect(result.current.progressPercent).toBe(80);
    expect(result.current.isDragging).toBe(true);

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 80 }));
    });
    expect(result.current.isDragging).toBe(false);
    // After release, dragTime cleared — falls back to currentTime.
    expect(result.current.progressPercent).toBe(10);
  });

  it("touch drag throttles moves the same way and commits on touchend", () => {
    const seek = vi.fn();
    const { result } = renderHook(() =>
      useSeekBar({ duration: 100, currentTime: 0, buffered: 0, seek }),
    );
    attachFakeBar(result.current);

    act(() => {
      result.current.handleTouchStart({
        preventDefault: () => {},
        touches: [{ clientX: 10 } as Touch],
      } as unknown as React.TouchEvent);
    });
    expect(seek).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(20);
      result.current.handleTouchMove({
        touches: [{ clientX: 30 } as Touch],
      } as unknown as React.TouchEvent);
    });
    act(() => {
      vi.advanceTimersByTime(20);
      result.current.handleTouchMove({
        touches: [{ clientX: 50 } as Touch],
      } as unknown as React.TouchEvent);
    });
    // Still throttled.
    expect(seek).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleTouchEnd();
    });
    // touchend flushes the pending target.
    expect(seek).toHaveBeenCalledTimes(2);
    expect(seek).toHaveBeenLastCalledWith(50);
    expect(result.current.isDragging).toBe(false);
  });
});
