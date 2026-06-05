/**
 * Styles for Player.tsx. Extracted (prexu-ps6) so the Player module
 * focuses on hook composition + render structure.
 *
 * Plain object map of React.CSSProperties — keep it dumb. The shared
 * minimize-branch corner-container style lives with MinimizedPlayer.tsx
 * (it has its own concerns).
 */

import type React from "react";

export const playerStyles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    inset: 0,
    background: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    // Promote to its own compositor layer so inset: 0 re-resolves against
    // the new WebView viewport immediately after a tao window resize, without
    // waiting for the next opacity transition or mouse-move repaint (prexu-0p3).
    transform: "translateZ(0)",
    willChange: "transform",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    outline: "none",
  },
  nativeClickTarget: {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    // Minimum opacity for WebView2 hit-testing. Fully transparent areas
    // pass mouse events to the Win32 window behind — this thin overlay
    // is barely visible but ensures onMouseMove reaches React so controls
    // auto-show and click-to-pause work.
    background: "rgba(0,0,0,0.05)",
  },
  centerOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.3)",
    zIndex: 5,
  },
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1.25rem",
  },
  loadingMessage: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.35rem",
    color: "rgba(255,255,255,0.85)",
    animation: "fadeIn 0.4s ease-out",
  },
  loadingTitle: {
    fontSize: "1rem",
    fontWeight: 600,
  },
  loadingHint: {
    fontSize: "0.85rem",
    color: "rgba(255,255,255,0.55)",
  },
  loadingBackButton: {
    position: "absolute",
    top: "1.5rem",
    left: "1.5rem",
    background: "rgba(0,0,0,0.5)",
    border: "none",
    borderRadius: "50%",
    width: "44px",
    height: "44px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    cursor: "pointer",
    zIndex: 10,
  },
  bufferingOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.3)",
    zIndex: 5,
    pointerEvents: "none",
  },
};
