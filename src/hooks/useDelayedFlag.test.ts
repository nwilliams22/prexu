import { act, renderHook } from "@testing-library/react";
import { useDelayedFlag } from "./useDelayedFlag";

describe("useDelayedFlag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts false and stays false before the delay elapses", () => {
    const { result } = renderHook(
      ({ active }) => useDelayedFlag(active, 150),
      { initialProps: { active: true } },
    );
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(result.current).toBe(false);
  });

  it("flips true once the delay elapses while still active", () => {
    const { result } = renderHook(
      ({ active }) => useDelayedFlag(active, 150),
      { initialProps: { active: true } },
    );

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe(true);
  });

  it("never flips true if active goes false before the delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useDelayedFlag(active, 150),
      { initialProps: { active: true } },
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(false);
  });

  it("resets to false immediately when active goes false after being shown", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useDelayedFlag(active, 150),
      { initialProps: { active: true } },
    );

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);
  });
});
