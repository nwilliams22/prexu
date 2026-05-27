/**
 * Tests for useTransparentWindow (prexu-r3l, prexu-mto, prexu-7d3).
 *
 * The class flip is DEFERRED until either `player://host-window-ready` fires
 * or the safety-net timeout (250ms) elapses. Tests verify:
 *   - No class on mount when active=false (unchanged from r3l).
 *   - No class IMMEDIATELY on mount when active=true (the defer).
 *   - Class added when the Tauri event fires (event path).
 *   - Class added when the timeout fires (safety-net path).
 *   - Class removed synchronously on unmount.
 *   - Idempotent on re-renders with the same active value.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

let eventCallback: (() => void) | null = null;
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: () => void) => {
    eventCallback = cb;
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
} from "./useTransparentWindow";

beforeEach(() => {
  document.body.classList.remove(TRANSPARENT_BODY_CLASS);
  eventCallback = null;
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

    // Let the listen() promise resolve so the cb is registered.
    await act(async () => {
      await Promise.resolve();
    });
    expect(eventCallback).not.toBeNull();

    act(() => {
      eventCallback!();
    });

    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);
  });

  it("adds the class when the safety-net timeout fires (event never arrived)", () => {
    renderHook(() => useTransparentWindow(true));
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);
  });

  it("removes the class on unmount (after class was applied)", async () => {
    const { unmount } = renderHook(() => useTransparentWindow(true));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      eventCallback!();
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

  it("only adds the class once even if event AND timeout both arrive", async () => {
    renderHook(() => useTransparentWindow(true));
    await act(async () => {
      await Promise.resolve();
    });

    // Event arrives first.
    act(() => {
      eventCallback!();
    });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);

    // Subsequent timeout firing must not toggle the class off or thrash.
    act(() => {
      vi.advanceTimersByTime(500);
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
    });
    act(() => {
      eventCallback!();
    });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);

    rerender({ active: false });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });
});
