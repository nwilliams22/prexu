import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePosterSize } from "./usePosterSize";

const mockUseBreakpoint = vi.fn();
const mockUsePreferences = vi.fn();

vi.mock("./useBreakpoint", () => ({
  useBreakpoint: () => mockUseBreakpoint(),
}));

vi.mock("./usePreferences", () => ({
  usePreferences: () => mockUsePreferences(),
}));

function setMocks(bp: string, posterSize: string) {
  mockUseBreakpoint.mockReturnValue(bp);
  mockUsePreferences.mockReturnValue({
    preferences: { appearance: { posterSize } },
  });
}

describe("usePosterSize", () => {
  it("returns standard medium size for desktop", () => {
    setMocks("desktop", "medium");
    const { result } = renderHook(() => usePosterSize());

    expect(result.current.posterWidth).toBe(190);
    expect(result.current.posterHeight).toBe(285); // 190 * 1.5
    expect(result.current.preference).toBe("medium");
  });

  it("returns large-breakpoint sizes when bp is large", () => {
    setMocks("large", "medium");
    const { result } = renderHook(() => usePosterSize());

    expect(result.current.posterWidth).toBe(230);
    expect(result.current.posterHeight).toBe(345); // 230 * 1.5
  });

  it("respects small preference", () => {
    setMocks("desktop", "small");
    const { result } = renderHook(() => usePosterSize());

    expect(result.current.posterWidth).toBe(150);
  });

  it("respects large preference on large breakpoint", () => {
    setMocks("large", "large");
    const { result } = renderHook(() => usePosterSize());

    expect(result.current.posterWidth).toBe(280);
  });

  it("uses custom aspect ratio", () => {
    setMocks("desktop", "medium");
    const { result } = renderHook(() => usePosterSize(0.5625));

    expect(result.current.posterWidth).toBe(190);
    expect(result.current.posterHeight).toBe(107); // round(190 * 0.5625)
  });
});
