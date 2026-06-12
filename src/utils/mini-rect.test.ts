import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_MINI_RECT,
  MINI_RECT_STORAGE_KEY,
  MIN_MINI_HEIGHT,
  MIN_MINI_WIDTH,
  clampMiniSize,
  isMiniCorner,
  loadPersistedMiniRect,
  maxMiniSize,
  miniRectToContainerStyle,
  miniRectToMaskPosition,
  nearestCorner,
  parseMiniRect,
  saveMiniRect,
  type MiniRect,
} from "./mini-rect";

vi.mock("../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("isMiniCorner", () => {
  it("accepts the four valid identifiers", () => {
    for (const c of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
      expect(isMiniCorner(c)).toBe(true);
    }
  });
  it("rejects bogus values", () => {
    expect(isMiniCorner("middle")).toBe(false);
    expect(isMiniCorner(null)).toBe(false);
    expect(isMiniCorner(undefined)).toBe(false);
    expect(isMiniCorner(42)).toBe(false);
  });
});

describe("clampMiniSize", () => {
  it("respects the per-axis minimum", () => {
    const r = clampMiniSize(100, 80, 1920, 1080);
    expect(r.width).toBe(MIN_MINI_WIDTH);
    expect(r.height).toBe(MIN_MINI_HEIGHT);
  });
  it("respects the upper bound (half viewport, capped at 1280×720)", () => {
    // Huge requested size on a 4K viewport → 1280×720 cap kicks in.
    const r4k = clampMiniSize(9999, 9999, 3840, 2160);
    expect(r4k.width).toBe(1280);
    expect(r4k.height).toBe(720);
    // On a 1024×768 viewport the half-viewport cap (512×384) wins.
    const r1k = clampMiniSize(9999, 9999, 1024, 768);
    expect(r1k.width).toBe(512);
    expect(r1k.height).toBe(384);
  });
  it("passes through values inside the range untouched", () => {
    const r = clampMiniSize(480, 270, 1920, 1080);
    expect(r).toEqual({ width: 480, height: 270 });
  });
});

describe("maxMiniSize", () => {
  it("returns half-viewport when below the 1280×720 ceiling", () => {
    expect(maxMiniSize(1280, 720)).toEqual({ width: 640, height: 360 });
  });
  it("caps at 1280×720 on large viewports", () => {
    expect(maxMiniSize(3840, 2160)).toEqual({ width: 1280, height: 720 });
  });
});

describe("miniRectToContainerStyle", () => {
  it("anchors bottom-right by default", () => {
    const style = miniRectToContainerStyle({
      corner: "bottom-right",
      width: 360,
      height: 200,
      padding: 16,
    });
    expect(style.bottom).toBe(16);
    expect(style.right).toBe(16);
    expect(style.top).toBeUndefined();
    expect(style.left).toBeUndefined();
    expect(style.width).toBe(360);
    expect(style.height).toBe(200);
  });
  it("uses top+left for top-left", () => {
    const s = miniRectToContainerStyle({
      corner: "top-left",
      width: 300,
      height: 180,
      padding: 12,
    });
    expect(s.top).toBe(12);
    expect(s.left).toBe(12);
    expect(s.bottom).toBeUndefined();
    expect(s.right).toBeUndefined();
  });
  it("uses top+right for top-right", () => {
    const s = miniRectToContainerStyle({
      corner: "top-right",
      width: 300,
      height: 180,
      padding: 12,
    });
    expect(s.top).toBe(12);
    expect(s.right).toBe(12);
  });
  it("uses bottom+left for bottom-left", () => {
    const s = miniRectToContainerStyle({
      corner: "bottom-left",
      width: 300,
      height: 180,
      padding: 12,
    });
    expect(s.bottom).toBe(12);
    expect(s.left).toBe(12);
  });
});

describe("miniRectToMaskPosition", () => {
  const cases: { corner: MiniRect["corner"]; expected: string }[] = [
    { corner: "top-left", expected: "top 16px left 16px" },
    { corner: "top-right", expected: "top 16px right 16px" },
    { corner: "bottom-left", expected: "bottom 16px left 16px" },
    { corner: "bottom-right", expected: "bottom 16px right 16px" },
  ];
  for (const { corner, expected } of cases) {
    it(`returns "${expected}" for ${corner}`, () => {
      const pos = miniRectToMaskPosition({
        corner,
        width: 360,
        height: 200,
        padding: 16,
      });
      expect(pos).toBe(expected);
    });
  }
  it("inlines a non-default padding", () => {
    expect(
      miniRectToMaskPosition({
        corner: "bottom-right",
        width: 300,
        height: 200,
        padding: 32,
      }),
    ).toBe("bottom 32px right 32px");
  });
});

describe("nearestCorner", () => {
  // 1920×1080 viewport, default rect size + padding. Cursor near each
  // corner anchor centre should snap to that corner.
  const rect = { width: 360, height: 200, padding: 16 };
  const vw = 1920;
  const vh = 1080;

  it("snaps to top-left for a cursor in the top-left quadrant", () => {
    expect(nearestCorner({ x: 100, y: 100 }, rect, vw, vh)).toBe("top-left");
  });
  it("snaps to top-right for a cursor in the top-right quadrant", () => {
    expect(nearestCorner({ x: 1800, y: 80 }, rect, vw, vh)).toBe("top-right");
  });
  it("snaps to bottom-left for a cursor in the bottom-left quadrant", () => {
    expect(nearestCorner({ x: 50, y: 1000 }, rect, vw, vh)).toBe("bottom-left");
  });
  it("snaps to bottom-right for a cursor in the bottom-right quadrant", () => {
    expect(nearestCorner({ x: 1850, y: 1020 }, rect, vw, vh)).toBe("bottom-right");
  });
  it("uses anchor centres (not just quadrants) for the comparison", () => {
    // Cursor at exact viewport centre — distance is identical to all four,
    // so the first in iteration order (top-left) wins.
    const exact = nearestCorner(
      { x: vw / 2, y: vh / 2 },
      rect,
      vw,
      vh,
    );
    expect(exact).toBe("top-left");
  });
});

describe("parseMiniRect", () => {
  it("accepts a full valid object", () => {
    const r = parseMiniRect({
      corner: "top-right",
      width: 400,
      height: 240,
      padding: 12,
    });
    expect(r).toEqual({
      corner: "top-right",
      width: 400,
      height: 240,
      padding: 12,
    });
  });
  it("rejects unknown corner", () => {
    expect(
      parseMiniRect({
        corner: "middle",
        width: 360,
        height: 200,
        padding: 16,
      }),
    ).toBeNull();
  });
  it("rejects out-of-bounds sizes", () => {
    expect(
      parseMiniRect({
        corner: "top-left",
        width: 100, // below MIN_MINI_WIDTH (240)
        height: 200,
        padding: 16,
      }),
    ).toBeNull();
    expect(
      parseMiniRect({
        corner: "top-left",
        width: 4000, // above the hard 1280 cap
        height: 200,
        padding: 16,
      }),
    ).toBeNull();
  });
  it("rejects negative or huge padding", () => {
    expect(
      parseMiniRect({
        corner: "top-left",
        width: 360,
        height: 200,
        padding: -1,
      }),
    ).toBeNull();
    expect(
      parseMiniRect({
        corner: "top-left",
        width: 360,
        height: 200,
        padding: 999,
      }),
    ).toBeNull();
  });
  it("rejects non-finite numbers", () => {
    expect(
      parseMiniRect({
        corner: "top-left",
        width: NaN,
        height: 200,
        padding: 16,
      }),
    ).toBeNull();
  });
  it("rejects non-objects", () => {
    expect(parseMiniRect(null)).toBeNull();
    expect(parseMiniRect("string")).toBeNull();
    expect(parseMiniRect(42)).toBeNull();
  });
});

describe("loadPersistedMiniRect / saveMiniRect", () => {
  it("returns the default when nothing is stored", () => {
    expect(loadPersistedMiniRect()).toEqual(DEFAULT_MINI_RECT);
  });
  it("round-trips a saved rect", () => {
    const rect: MiniRect = {
      corner: "top-left",
      width: 480,
      height: 270,
      padding: 20,
    };
    saveMiniRect(rect);
    expect(loadPersistedMiniRect()).toEqual(rect);
  });
  it("falls back to default on malformed JSON", () => {
    localStorage.setItem(MINI_RECT_STORAGE_KEY, "{not json");
    expect(loadPersistedMiniRect()).toEqual(DEFAULT_MINI_RECT);
  });
  it("falls back to default on schema mismatch", () => {
    localStorage.setItem(
      MINI_RECT_STORAGE_KEY,
      JSON.stringify({ corner: "middle", width: 100, height: 100, padding: 0 }),
    );
    expect(loadPersistedMiniRect()).toEqual(DEFAULT_MINI_RECT);
  });
});
