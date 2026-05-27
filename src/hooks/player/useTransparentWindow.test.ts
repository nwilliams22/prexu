/**
 * Tests for useTransparentWindow (prexu-r3l, prexu-mto, prexu-7d3).
 *
 * The class flip is DEFERRED until either `player://host-window-ready` fires
 * or the safety-net timeout elapses. Tests verify:
 *   - No class on mount when active=false (unchanged from r3l).
 *   - No class IMMEDIATELY on mount when active=true (the defer).
 *   - Class added when the Tauri event fires (event path).
 *   - Class added when the timeout fires (safety-net path).
 *   - Class removed synchronously on unmount.
 *   - Idempotent on re-renders with the same active value.
 *   - Transition busy/ready cycle drops + re-applies the class (prexu-7d3).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const callbacks: Record<string, (() => void) | undefined> = {};
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: () => void) => {
    callbacks[name] = cb;
    return unlistenMock;
  }),
}));

vi.mock("../../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

import {
  useTransparentWindow,
  TRANSPARENT_BODY_CLASS,
  HOST_READY_FALLBACK_MS,
} from "./useTransparentWindow";

const READY = "player://host-window-ready";
const BUSY = "player://host-window-busy";

const fireReady = () => callbacks[READY]?.();
const fireBusy = () => callbacks[BUSY]?.();

/**
 * Drive the two requestAnimationFrame ticks the transition-ready path
 * uses to defer the class re-add. JSDOM's rAF is timer-backed under
 * fake timers, so advancing by ~16ms per frame is enough.
 */
const flushTransitionRaf = () => {
  act(() => {
    vi.advanceTimersByTime(16);
  });
  act(() => {
    vi.advanceTimersByTime(16);
  });
};

beforeEach(() => {
  document.body.classList.remove(TRANSPARENT_BODY_CLASS);
  for (const k of Object.keys(callbacks)) delete callbacks[k];
  unlistenMock.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTransparentWindow", () => {
  it("does NOT add the class when active=false", () => {
    renderHook(() => useTransparentWindow(false));
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });

  it("does NOT add the class synchronously on mount when active=true (deferred)", () => {
    renderHook(() => useTransparentWindow(true));
    // The defer is the whole point of mto: opaque while mpv has no frame yet.
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });

  it("adds the class when player://host-window-ready fires", async () => {
    renderHook(() => useTransparentWindow(true));

    // Let the listen() promises resolve so callbacks are registered.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(callbacks[READY]).toBeDefined();

    act(() => {
      fireReady();
    });

    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);
  });

  it("adds the class when the safety-net timeout fires (event never arrived)", () => {
    renderHook(() => useTransparentWindow(true));
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);

    // Class must NOT flip a hair before the fallback window.
    act(() => {
      vi.advanceTimersByTime(HOST_READY_FALLBACK_MS - 1);
    });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);
  });

  it("removes the class on unmount (after class was applied)", async () => {
    const { unmount } = renderHook(() => useTransparentWindow(true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      fireReady();
    });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);

    unmount();
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });

  it("removes the class on unmount even if it was never applied", () => {
    const { unmount } = renderHook(() => useTransparentWindow(true));
    // Don't fire the event or advance the timer — class never gets added.
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
    unmount();
    // Removal is idempotent — the cleanup runs regardless.
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });

  it("only applies the initial class once even if event AND timeout both arrive", async () => {
    renderHook(() => useTransparentWindow(true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Event arrives first → initial apply.
    act(() => {
      fireReady();
    });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);

    // Subsequent timeout firing must not toggle the class off or thrash.
    act(() => {
      vi.advanceTimersByTime(HOST_READY_FALLBACK_MS + 1);
    });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);
  });

  it("adds the class on flip false → true and removes on flip back", async () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useTransparentWindow(active),
      { initialProps: { active: false } },
    );
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);

    rerender({ active: true });
    // Still deferred until event/timeout.
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      fireReady();
    });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);

    rerender({ active: false });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });

  // --- prexu-7d3 transition cycle -----------------------------------------

  it("drops the class on player://host-window-busy after initial apply", async () => {
    renderHook(() => useTransparentWindow(true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => fireReady());
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);

    act(() => fireBusy());
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });

  it("ignores busy before initial apply (no premature toggle)", async () => {
    renderHook(() => useTransparentWindow(true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Class was never added yet.
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);

    act(() => fireBusy());
    // Still off, no thrash.
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });

  it("re-applies class after busy/ready cycle but defers the re-add via rAF", async () => {
    renderHook(() => useTransparentWindow(true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => fireReady());
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);

    act(() => fireBusy());
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);

    // Transition complete signal — but the re-add is deferred through
    // two requestAnimationFrame ticks so WebView2 commits the underlying
    // route's paint first.
    act(() => fireReady());
    // Synchronously after ready, the class is still off.
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);

    flushTransitionRaf();
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);
  });

  it("a second busy during a pending re-add cancels the deferred add", async () => {
    renderHook(() => useTransparentWindow(true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => fireReady()); // initial apply
    act(() => fireBusy()); // class off, transition begins
    act(() => fireReady()); // re-add scheduled

    // Another transition starts before the rAF re-add fires.
    act(() => fireBusy());
    flushTransitionRaf();
    // The pending re-add from the first ready must have been cancelled,
    // so we're still off after the rAF window passes.
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });
});
