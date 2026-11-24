import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePlayerLayerStyle } from "./usePlayerLayerStyle";

vi.mock("../../contexts/PlayerContext", () => ({
  usePlayerSession: vi.fn(),
  usePlayerBrowserPiP: vi.fn(),
  usePlayerMinimize: vi.fn(),
}));

import {
  usePlayerSession,
  usePlayerBrowserPiP,
  usePlayerMinimize,
} from "../../contexts/PlayerContext";

const mockUsePlayerSession = vi.mocked(usePlayerSession);
const mockUsePlayerMinimize = vi.mocked(usePlayerMinimize);

const BASE_MINI_RECT = {
  corner: "bottom-right" as const,
  width: 360,
  height: 200,
  padding: 16,
};

function setupContext(args: {
  session: { ratingKey: string } | null;
  isMinimized: boolean;
  miniRect?: typeof BASE_MINI_RECT;
}) {
  mockUsePlayerSession.mockReturnValue({
    session: args.session,
    play: vi.fn(),
    stop: vi.fn(),
    replaceRatingKey: vi.fn(),
    updateSession: vi.fn(),
  });
  mockUsePlayerMinimize.mockReturnValue({
    isMinimized: args.isMinimized,
    miniRect: args.miniRect ?? BASE_MINI_RECT,
    minimize: vi.fn(),
    restoreFromMinimize: vi.fn(),
    updateMiniRect: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usePlayerBrowserPiP).mockReturnValue({ isBrowserPiPActive: false, setIsBrowserPiPActive: vi.fn() });
});

describe("usePlayerLayerStyle", () => {
  it("returns empty-baseline object when no session", () => {
    setupContext({ session: null, isMinimized: false });

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
    setupContext({ session: { ratingKey: "42" }, isMinimized: false });

    const { result } = renderHook(() => usePlayerLayerStyle());

    expect(result.current.opacity).toBe(0);
    expect(result.current.pointerEvents).toBe("none");
    expect(result.current.willChange).toBe("opacity");
    expect(result.current.transform).toBe("translateZ(0)");
    expect(result.current.maskImage).toContain("linear-gradient");
    expect(result.current.WebkitMaskImage).toContain("linear-gradient");
  });

  it("returns opacity:1 and pointerEvents:auto in minimize mode (session present, isMinimized)", () => {
    setupContext({ session: { ratingKey: "42" }, isMinimized: true });

    const { result } = renderHook(() => usePlayerLayerStyle());

    expect(result.current.opacity).toBe(1);
    expect(result.current.pointerEvents).toBe("auto");
    expect(result.current.willChange).toBe("opacity");
    expect(result.current.transform).toBe("translateZ(0)");
    expect(result.current.maskImage).toContain("linear-gradient");
  });

  it("mask-position string reflects the miniRect corner (bottom-right at padding=16)", () => {
    setupContext({
      session: { ratingKey: "42" },
      isMinimized: true,
      miniRect: { corner: "bottom-right", width: 360, height: 200, padding: 16 },
    });

    const { result } = renderHook(() => usePlayerLayerStyle());

    // maskPosition = "0 0, bottom 16px right 16px"
    expect(result.current.maskPosition).toBe("0 0, bottom 16px right 16px");
    expect(result.current.WebkitMaskPosition).toBe("0 0, bottom 16px right 16px");
  });

  it("mask-position string reflects the miniRect corner (top-left at padding=8)", () => {
    setupContext({
      session: { ratingKey: "42" },
      isMinimized: true,
      miniRect: { corner: "top-left", width: 360, height: 200, padding: 8 },
    });

    const { result } = renderHook(() => usePlayerLayerStyle());

    expect(result.current.maskPosition).toBe("0 0, top 8px left 8px");
    expect(result.current.WebkitMaskPosition).toBe("0 0, top 8px left 8px");
  });
});

it("reveals the whole library during browser PiP and restores the full player layer on exit", () => {
  setupContext({ session: { ratingKey: "42" }, isMinimized: false });
  const { result, rerender } = renderHook(() => usePlayerLayerStyle());
  vi.mocked(usePlayerBrowserPiP).mockReturnValue({ isBrowserPiPActive: true, setIsBrowserPiPActive: vi.fn() });
  rerender();
  expect(result.current.opacity).toBe(1);
  expect(result.current.pointerEvents).toBe("auto");
  expect(result.current.maskImage).toBeUndefined();
  expect(result.current.WebkitMaskImage).toBeUndefined();
  vi.mocked(usePlayerBrowserPiP).mockReturnValue({ isBrowserPiPActive: false, setIsBrowserPiPActive: vi.fn() });
  rerender();
  expect(result.current.opacity).toBe(0);
  expect(result.current.pointerEvents).toBe("none");
});
