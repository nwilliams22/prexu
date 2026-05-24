import type React from "react";
import { usePlayerSession } from "../../contexts/PlayerContext";
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
 * prexu-quq: keep the AppLayout mask STATIC across full-player ↔
 * minimize. The corner hole is applied whenever a player session is
 * active — full-player or minimize. Switching between modes only
 * changes OPACITY (0 in full-player, 1 in minimize). This avoids the
 * ~1s Dashboard repaint we were hitting when the mask shape changed:
 * mask-size/mask-position transitions invalidate the compositor
 * cache, forcing the browser to re-paint every child of AppLayout.
 *
 * Opacity is a pure GPU compositor toggle on a persistent layer.
 * To make sure the browser doesn't optimize away the painted layer
 * while opacity is 0, we add `will-change: opacity` AND
 * `transform: translateZ(0)` whenever a session exists — these two
 * together force a persistent GPU layer that survives opacity:0
 * without being purged.
 *
 * Why the corner hole in full-player mode? It's invisible anyway
 * (whole element at opacity:0), so the hole shape doesn't matter
 * visually. Keeping the SAME mask means zero compositor invalidation
 * on transition. The hole only "matters" when opacity flips back
 * to 1 in minimize mode.
 *
 * pointerEvents:none in full-player so clicks pass through to
 * PlayerOverlay below.
 *
 * History of this hiding mechanism on this branch:
 *   prexu-kfa  → introduced visibility:hidden (replaced display:none
 *                which broke VirtualizedLibraryGrid's clientWidth)
 *   prexu-ya6  → gated on !isMinimized so app shows in 7il.3
 *   prexu-cay  → switched to opacity:0 to keep paint warm
 *   prexu-9bk  → switched to mask-based hiding because opacity:0
 *                still allowed paint-skip on Dashboard
 *   prexu-quq  → realized the mask CHANGE was the cost; keep mask
 *                static + use opacity + will-change for the toggle
 *
 * prexu-s0f, prexu-4ml, prexu-7il.5/7: corner hole is sized + positioned
 * from PlayerContext.miniRect so it matches Player.tsx's miniContainer
 * exactly. Four-value mask-position syntax (`right 16px bottom 16px`,
 * `top 16px left 16px`, …) — NOT calc(100% - 376px) which percentage-
 * rule-resolves wrong. Both axes track miniRect so user-resize +
 * anchor-drag are reflected in the AppLayout cut-out as soon as the
 * user releases the mouse (and live during resize drag).
 */
export function usePlayerLayerStyle(): React.CSSProperties {
  const playerSession = usePlayerSession();

  const isFullPlayer =
    playerSession.session != null && !playerSession.isMinimized;
  const hasSession = playerSession.session != null;

  const miniRect = playerSession.miniRect;
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
