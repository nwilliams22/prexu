import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVideoClickHandling } from "./useVideoClickHandling";

afterEach(() => vi.useRealTimers());

describe("video click handling", () => {
  it("toggles immediately and never toggles again when the single-click window expires", () => {
    vi.useFakeTimers();
    const togglePlay = vi.fn();
    const toggleFullscreen = vi.fn();
    const { result } = renderHook(() => useVideoClickHandling(togglePlay, toggleFullscreen, vi.fn()));
    act(() => result.current());
    expect(togglePlay).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(300));
    expect(togglePlay).toHaveBeenCalledTimes(1);
    expect(toggleFullscreen).not.toHaveBeenCalled();
  });

  it.each([true, false])("restores playback before fullscreen when initially playing=%s", (initialPlaying) => {
    vi.useFakeTimers();
    let playing = initialPlaying;
    const togglePlay = vi.fn(() => { playing = !playing; });
    const toggleFullscreen = vi.fn(() => { expect(playing).toBe(initialPlaying); });
    const { result, unmount } = renderHook(() => useVideoClickHandling(togglePlay, toggleFullscreen, vi.fn()));
    act(() => result.current());
    expect(playing).toBe(!initialPlaying);
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current());
    expect(toggleFullscreen).toHaveBeenCalledTimes(1);
    expect(playing).toBe(initialPlaying);
    unmount();
    act(() => vi.advanceTimersByTime(300));
    expect(togglePlay).toHaveBeenCalledTimes(2);
  });
});
