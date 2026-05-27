import type React from "react";
import {
  usePlayerSession,
  usePlayerMinimize,
} from "../../contexts/PlayerContext";
import { miniRectToMaskPosition } from "../../utils/mini-rect";

/**
 * Style props for the layer that hosts the route tree while a native-mpv
 * session is open. When a session is active, the layer:
 *   - Stays painted (will-change + translateZ to keep the GPU layer warm)
 *   - Masks a corner-hole at the mini-player rect so the Win32 mpv host
 *     (behind the WebView) shines through when minimized
 *   - Fades to opacity:0 + pointerEvents:none in full-player mode so
 *     clicks pass through to the player overlay
 *
 * Returns `{}` (semantically empty) when no session — AppLayout
 * spreads the result unconditionally, getting plain navy chrome.
 *
 * The AppLayout mask is kept STATIC across full-player ↔ minimize. The
 * corner hole is applied whenever a player session is active — full-player
 * or minimize. Switching between modes only changes OPACITY (0 in
 * full-player, 1 in minimize). This avoids a Dashboard repaint when the
 * mask shape changes: mask-size/mask-position transitions invalidate the
 * compositor cache, forcing the browser to re-paint every child of
 * AppLayout.
 *
 * Opacity is a pure GPU compositor toggle on a persistent layer.
 * To prevent the browser from optimizing away the layer while opacity is 0,
 * `will-change: opacity` AND `transform: translateZ(0)` are added whenever
 * a session exists — these together force a persistent GPU layer that
 * survives opacity:0 without being purged.
 *
 * The corner hole is invisible in full-player mode (whole element at
 * opacity:0), so the hole shape doesn't matter visually. Keeping the SAME
 * mask means zero compositor invalidation on transition. The hole only
 * "matters" when opacity flips back to 1 in minimize mode.
 *
 * pointerEvents:none in full-player so clicks pass through to
 * PlayerOverlay below.
 *
 * The corner hole is sized + positioned from PlayerContext.miniRect so it
 * matches Player.tsx's miniContainer exactly. Four-value mask-position
 * syntax (`right 16px bottom 16px`, `top 16px left 16px`, …) — NOT
 * calc(100% - 376px) which percentage-resolves wrong. Both axes track
 * miniRect so user-resize + anchor-drag are reflected in the AppLayout
 * cut-out as soon as the user releases the mouse (and live during resize).
 */
export function usePlayerLayerStyle(): React.CSSProperties {
  const { session } = usePlayerSession();
  const { isMinimized, miniRect } = usePlayerMinimize();

  const isFullPlayer = session != null && !isMinimized;
  const hasSession = session != null;

  const maskSize = `100% 100%, ${miniRect.width}px ${miniRect.height}px`;
  const maskPosition = `0 0, ${miniRectToMaskPosition(miniRect)}`;

  const maskStyle: React.CSSProperties = hasSession
    ? {
        WebkitMaskImage:
          "linear-gradient(#000, #000), linear-gradient(#000, #000)",
        maskImage:
          "linear-gradient(#000, #000), linear-gradient(#000, #000)",
        WebkitMaskSize: maskSize,
        maskSize: maskSize,
        WebkitMaskPosition: maskPosition,
        maskPosition: maskPosition,
        WebkitMaskRepeat: "no-repeat, no-repeat",
        maskRepeat: "no-repeat, no-repeat",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
      }
    : {};

  const layerStyle: React.CSSProperties = hasSession
    ? {
        willChange: "opacity",
        transform: "translateZ(0)",
      }
    : {};

  return {
    opacity: isFullPlayer ? 0 : 1,
    pointerEvents: isFullPlayer ? "none" : "auto",
    ...layerStyle,
    ...maskStyle,
  };
}
