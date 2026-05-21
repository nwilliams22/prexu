/**
 * Helpers for the in-window mini-player rect (prexu-7il.5 / prexu-7il.7).
 *
 * The mini player is parameterised by `MiniRect = { corner, width, height,
 * padding }`. These helpers convert the rect into:
 *
 * - CSS positioning props for the `Player.tsx` miniContainer (`top`/`bottom`
 *   + `left`/`right`)
 * - Four-value mask-position string for the `AppLayout.tsx` corner hole
 * - Anchor-snap math: given a cursor `(x, y)` and the viewport size, pick
 *   the nearest of the four corner anchor points
 * - Persistence (load/save from localStorage with graceful validation)
 *
 * Centralising this here keeps `PlayerContext` slim and gives us a stable
 * surface for unit tests.
 */

import { logger } from "../services/logger";

/** Four-corner anchor for the mini player. Mirrors the Rust corner enum. */
export type MiniCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface MiniRect {
  corner: MiniCorner;
  width: number;
  height: number;
  padding: number;
}

/** Default size + padding when nothing is persisted. Matches the previous
 *  hard-coded `MINIMIZE_DEFAULT_*` block in PlayerContext. */
export const DEFAULT_MINI_RECT: MiniRect = {
  corner: "bottom-right",
  width: 360,
  height: 200,
  padding: 16,
};

/** Lower bound on user-resize. ~16:9 at 240 wide so the chrome buttons
 *  remain comfortably visible. */
export const MIN_MINI_WIDTH = 240;
export const MIN_MINI_HEIGHT = 135;

/** Upper bound — half the smaller viewport dim each, but never exceeding
 *  a hard ceiling of 1280×720 so the "mini" stays meaningfully smaller
 *  than the typical desktop window. Returns a fresh max each call so the
 *  bound tracks live viewport changes. */
export function maxMiniSize(
  viewportWidth: number,
  viewportHeight: number,
): { width: number; height: number } {
  return {
    width: Math.min(Math.floor(viewportWidth / 2), 1280),
    height: Math.min(Math.floor(viewportHeight / 2), 720),
  };
}

/** Clamp a candidate (width, height) to the [MIN..max] range for the
 *  current viewport. */
export function clampMiniSize(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { width: number; height: number } {
  const max = maxMiniSize(viewportWidth, viewportHeight);
  return {
    width: Math.min(Math.max(width, MIN_MINI_WIDTH), Math.max(max.width, MIN_MINI_WIDTH)),
    height: Math.min(Math.max(height, MIN_MINI_HEIGHT), Math.max(max.height, MIN_MINI_HEIGHT)),
  };
}

const VALID_CORNERS: MiniCorner[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

export function isMiniCorner(value: unknown): value is MiniCorner {
  return typeof value === "string" && (VALID_CORNERS as string[]).includes(value);
}

/**
 * Compute the CSS top/bottom/left/right offsets for a mini container
 * anchored to `corner` with `padding` pixels of gutter. Width/height are
 * passed through verbatim so the caller can spread them straight onto a
 * style object.
 */
export function miniRectToContainerStyle(rect: MiniRect): React.CSSProperties {
  const { corner, padding, width, height } = rect;
  const base: React.CSSProperties = { width, height };
  switch (corner) {
    case "top-left":
      return { ...base, top: padding, left: padding };
    case "top-right":
      return { ...base, top: padding, right: padding };
    case "bottom-left":
      return { ...base, bottom: padding, left: padding };
    case "bottom-right":
    default:
      return { ...base, bottom: padding, right: padding };
  }
}

/**
 * Compute the four-value `mask-position` string for AppLayout's corner
 * hole. The mask has two layers: full (`0 0`) and the corner hole — this
 * returns the hole's position, e.g. `"top 16px left 16px"`.
 *
 * Using the four-value syntax (`top Y left X`) instead of `calc(100% - …)`
 * matters because percentage-based positions resolve relative to (container
 * - mask) rather than the corner, which drifted by exactly mask-size's
 * worth from the desired anchor on the first mini-mode build.
 */
export function miniRectToMaskPosition(rect: MiniRect): string {
  const { corner, padding } = rect;
  const pad = `${padding}px`;
  switch (corner) {
    case "top-left":
      return `top ${pad} left ${pad}`;
    case "top-right":
      return `top ${pad} right ${pad}`;
    case "bottom-left":
      return `bottom ${pad} left ${pad}`;
    case "bottom-right":
    default:
      return `bottom ${pad} right ${pad}`;
  }
}

/** The cursor point chosen as the centre of the mini rect for snap-anchor
 *  distance comparisons. */
interface Point {
  x: number;
  y: number;
}

/** Corner anchor points (centres of each corner mini-rect) for the given
 *  viewport + rect. Used by `nearestCorner`. */
function cornerCenters(
  rect: Pick<MiniRect, "width" | "height" | "padding">,
  viewportWidth: number,
  viewportHeight: number,
): Record<MiniCorner, Point> {
  const { width, height, padding } = rect;
  const halfW = width / 2;
  const halfH = height / 2;
  return {
    "top-left": { x: padding + halfW, y: padding + halfH },
    "top-right": { x: viewportWidth - padding - halfW, y: padding + halfH },
    "bottom-left": { x: padding + halfW, y: viewportHeight - padding - halfH },
    "bottom-right": {
      x: viewportWidth - padding - halfW,
      y: viewportHeight - padding - halfH,
    },
  };
}

/**
 * Given the cursor position at mouse-up (assumed to be the centre of the
 * dragged ghost), return the corner whose anchor centre is nearest.
 * Ties (extremely unlikely on a real viewport) prefer the earlier entry
 * in the `VALID_CORNERS` order.
 */
export function nearestCorner(
  cursor: Point,
  rect: Pick<MiniRect, "width" | "height" | "padding">,
  viewportWidth: number,
  viewportHeight: number,
): MiniCorner {
  const centers = cornerCenters(rect, viewportWidth, viewportHeight);
  let best: MiniCorner = "bottom-right";
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const corner of VALID_CORNERS) {
    const c = centers[corner];
    const dx = cursor.x - c.x;
    const dy = cursor.y - c.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      best = corner;
      bestDistSq = distSq;
    }
  }
  return best;
}

// ── Persistence ──────────────────────────────────────────────────────────

/** localStorage key. Versioned via the shape itself — out-of-range or
 *  malformed payloads silently fall back to the default. */
export const MINI_RECT_STORAGE_KEY = "mini-player.rect";

/** Validate an unknown value as a MiniRect. Returns null on any failure
 *  so callers can use the default instead of crashing. */
export function parseMiniRect(value: unknown): MiniRect | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (!isMiniCorner(obj.corner)) return null;
  if (typeof obj.width !== "number" || !Number.isFinite(obj.width)) return null;
  if (typeof obj.height !== "number" || !Number.isFinite(obj.height)) return null;
  if (typeof obj.padding !== "number" || !Number.isFinite(obj.padding)) return null;
  if (obj.width < MIN_MINI_WIDTH || obj.height < MIN_MINI_HEIGHT) return null;
  // Hard upper bound — even on huge displays the cap shouldn't exceed 1280×720.
  if (obj.width > 1280 || obj.height > 720) return null;
  if (obj.padding < 0 || obj.padding > 128) return null;
  return {
    corner: obj.corner,
    width: obj.width,
    height: obj.height,
    padding: obj.padding,
  };
}

/** Load + validate the persisted rect, falling back to the default on any
 *  parse error. Reads from localStorage synchronously (the data is tiny and
 *  reading at mount avoids a one-frame layout shift). */
export function loadPersistedMiniRect(): MiniRect {
  if (typeof localStorage === "undefined") return DEFAULT_MINI_RECT;
  try {
    const raw = localStorage.getItem(MINI_RECT_STORAGE_KEY);
    if (!raw) return DEFAULT_MINI_RECT;
    const parsed = parseMiniRect(JSON.parse(raw));
    if (!parsed) {
      logger.warn("player:minimize", "stored mini-rect invalid, using default", { raw });
      return DEFAULT_MINI_RECT;
    }
    return parsed;
  } catch (err) {
    logger.warn("player:minimize", "stored mini-rect parse failed", String(err));
    return DEFAULT_MINI_RECT;
  }
}

/** Persist the rect. Best-effort — failures (quota, private mode, …) are
 *  logged and swallowed so the in-memory state still works. */
export function saveMiniRect(rect: MiniRect): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MINI_RECT_STORAGE_KEY, JSON.stringify(rect));
  } catch (err) {
    logger.warn("player:minimize", "saving mini-rect failed", String(err));
  }
}
