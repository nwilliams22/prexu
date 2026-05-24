import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePlayerLayerStyle } from "./usePlayerLayerStyle";

vi.mock("../../contexts/PlayerContext", () => ({
  usePlayerSession: vi.fn(),
}));

import { usePlayerSession } from "../../contexts/PlayerContext";

const mockUsePlayerSession = vi.mocked(usePlayerSession);

const BASE_MINI_RECT = {
  corner: "bottom-right" as const,
  width: 360,
  height: 200,
  padding: 16,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePlayerLayerStyle", () => {
  it("returns empty-baseline object when no session", () => {
    mockUsePlayerSession.mockReturnValue({
      session: null,
      isMinimized: false,
      miniRect: BASE_MINI_RECT,
      play: vi.fn(),
      stop: vi.fn(),
      replaceRatingKey: vi.fn(),
      updateSession: vi.fn(),
      minimize: vi.fn(),
      restoreFromMinimize: vi.fn(),
      updateMiniRect: vi.fn(),
    });

    const { result } = renderHook(() => usePlayerLayerStyle());

    expect(result.current).not.toHaveProperty("maskImage");
    expect(result.current).not.toHaveProperty("WebkitMaskImage");
    expect(result.current).not.toHaveProperty("willChange");
    expect(result.current).not.toHaveProperty("transform");
    // opacity/pointerEvents reflect the no-session (isFullPlayer=false) path:
    // no session so isFullPlayer=false → opacity:1, pointerEvents:"auto"
    expect(result.current.opacity).toBe(1);
    expect(result.current.pointerEvents).toBe("auto");
  });

  it("returns opacity:0 and pointerEvents:none in full-player mode (session present, not minimized)", () => {
    mockUsePlayerSession.mockReturnValue({
      session: { ratingKey: "42" },
      isMinimized: false,
      miniRect: BASE_MINI_RECT,
      play: vi.fn(),
      stop: vi.fn(),
      replaceRatingKey: vi.fn(),
      updateSession: vi.fn(),
      minimize: vi.fn(),
      restoreFromMinimize: vi.fn(),
      updateMiniRect: vi.fn(),
    });

    const { result } = renderHook(() => usePlayerLayerStyle());

    expect(result.current.opacity).toBe(0);
    expect(result.current.pointerEvents).toBe("none");
    expect(result.current.willChange).toBe("opacity");
    expect(result.current.transform).toBe("translateZ(0)");
    expect(result.current.maskImage).toContain("linear-gradient");
    expect(result.current.WebkitMaskImage).toContain("linear-gradient");
  });

  it("returns opacity:1 and pointerEvents:auto in minimize mode (session present, isMinimized)", () => {
    mockUsePlayerSession.mockReturnValue({
      session: { ratingKey: "42" },
      isMinimized: true,
      miniRect: BASE_MINI_RECT,
      play: vi.fn(),
      stop: vi.fn(),
      replaceRatingKey: vi.fn(),
      updateSession: vi.fn(),
      minimize: vi.fn(),
      restoreFromMinimize: vi.fn(),
      updateMiniRect: vi.fn(),
    });

    const { result } = renderHook(() => usePlayerLayerStyle());

    expect(result.current.opacity).toBe(1);
    expect(result.current.pointerEvents).toBe("auto");
    expect(result.current.willChange).toBe("opacity");
    expect(result.current.transform).toBe("translateZ(0)");
    expect(result.current.maskImage).toContain("linear-gradient");
  });

  it("mask-position string reflects the miniRect corner (bottom-right at padding=16)", () => {
    mockUsePlayerSession.mockReturnValue({
      session: { ratingKey: "42" },
      isMinimized: true,
      miniRect: { corner: "bottom-right", width: 360, height: 200, padding: 16 },
      play: vi.fn(),
      stop: vi.fn(),
      replaceRatingKey: vi.fn(),
      updateSession: vi.fn(),
      minimize: vi.fn(),
      restoreFromMinimize: vi.fn(),
      updateMiniRect: vi.fn(),
    });

    const { result } = renderHook(() => usePlayerLayerStyle());

    // maskPosition = "0 0, bottom 16px right 16px"
    expect(result.current.maskPosition).toBe("0 0, bottom 16px right 16px");
    expect(result.current.WebkitMaskPosition).toBe("0 0, bottom 16px right 16px");
  });

  it("mask-position string reflects the miniRect corner (top-left at padding=8)", () => {
    mockUsePlayerSession.mockReturnValue({
      session: { ratingKey: "42" },
      isMinimized: true,
      miniRect: { corner: "top-left", width: 360, height: 200, padding: 8 },
      play: vi.fn(),
      stop: vi.fn(),
      replaceRatingKey: vi.fn(),
      updateSession: vi.fn(),
      minimize: vi.fn(),
      restoreFromMinimize: vi.fn(),
      updateMiniRect: vi.fn(),
    });

    const { result } = renderHook(() => usePlayerLayerStyle());

    expect(result.current.maskPosition).toBe("0 0, top 8px left 8px");
    expect(result.current.WebkitMaskPosition).toBe("0 0, top 8px left 8px");
  });
});
