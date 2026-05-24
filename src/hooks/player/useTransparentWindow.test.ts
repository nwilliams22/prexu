/**
 * Tests for useTransparentWindow (prexu-r3l).
 *
 * Verifies the class-toggle is the single owner of body transparency:
 * adds on mount-when-active, removes on unmount, no-op when inactive.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useTransparentWindow,
  TRANSPARENT_BODY_CLASS,
} from "./useTransparentWindow";

beforeEach(() => {
  document.body.classList.remove(TRANSPARENT_BODY_CLASS);
});

describe("useTransparentWindow", () => {
  it("does NOT add the class when active=false", () => {
    renderHook(() => useTransparentWindow(false));
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });

  it("adds the class when active=true", () => {
    renderHook(() => useTransparentWindow(true));
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);
  });

  it("removes the class on unmount", () => {
    const { unmount } = renderHook(() => useTransparentWindow(true));
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);
    unmount();
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });

  it("adds the class on flip false → true and removes on flip back", () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useTransparentWindow(active),
      { initialProps: { active: false } },
    );
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);

    rerender({ active: true });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);

    rerender({ active: false });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(false);
  });

  it("is idempotent against duplicate writes (no thrash)", () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useTransparentWindow(active),
      { initialProps: { active: true } },
    );
    // Re-rendering with the same active value should not change anything.
    rerender({ active: true });
    rerender({ active: true });
    expect(document.body.classList.contains(TRANSPARENT_BODY_CLASS)).toBe(true);
  });
});
