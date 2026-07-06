/**
 * Cursor-only resize affordance for the borderless pop-out player
 * (prexu-f4o4).
 *
 * Edge drag-resize of the undecorated pop-out window already works
 * (hardware-confirmed on Linux — see docs/linux-on-hardware-test-plan.md,
 * section E.3: "resizing works (wry's undecorated-resize handler)"). The
 * window manager's own edge/corner hit-testing happens at the compositor
 * level, BELOW the DOM — it grabs the resize before the event ever
 * reaches the webview. But because the webview fills the window right up
 * to its edges, the compositor's usual resize-cursor hint never surfaces:
 * the webview keeps painting its own default cursor over the exact pixels
 * where the OS would otherwise show a resize arrow, so a perfectly
 * functional resize zone LOOKS unresizable. This is undiscoverable, not
 * broken.
 *
 * This component adds pure CSS cursor feedback over those edges/corners.
 * It renders no visible chrome and attaches no click handlers — the
 * resize itself is already handled below the DOM, so these divs exist
 * only so the mouse cursor tells the truth about what the window manager
 * already lets you do. A thin div with only a `cursor` style and no
 * handlers cannot intercept or break a click: at worst it changes which
 * element visually receives a click at those exact edge pixels, and none
 * of them carry a handler.
 *
 * RESIZE_ZONE_PX approximates the resize-border width common across
 * Linux desktop environments (GNOME/KDE undecorated windows typically use
 * something in the 4-10px range). The window manager decides the real
 * hit-test width, not this app, so this is a best-effort visual match —
 * sized on the smaller side of that range so the cursor never promises a
 * wider grabbable zone than what's likely actually there.
 *
 * Render this only while pop-out is active (mirrors PopoutDragStrip's
 * gating in Player.tsx); it has no internal gating so it stays trivially
 * testable. Unlike PopoutDragStrip it does not fade with the controls
 * auto-hide state — cursor feedback has no visible chrome to hide, so it
 * stays live for the whole time the window is popped out.
 */

import type React from "react";

/** Thickness (px) of each edge/corner hit zone — see docblock for why
 *  this is an approximation rather than a value read from the compositor. */
const RESIZE_ZONE_PX = 8;

const base: React.CSSProperties = {
  position: "absolute",
  // Below PopoutDragStrip (zIndex 30) so the drag-move strip's "grab"
  // cursor still wins across the top band while it's visible; these
  // zones still show through once the strip auto-hides (opacity 0 +
  // pointerEvents: none removes it from hit-testing entirely).
  zIndex: 25,
  pointerEvents: "auto",
};

const styles: Record<string, React.CSSProperties> = {
  top: {
    ...base,
    top: 0,
    left: RESIZE_ZONE_PX,
    right: RESIZE_ZONE_PX,
    height: RESIZE_ZONE_PX,
    cursor: "ns-resize",
  },
  bottom: {
    ...base,
    bottom: 0,
    left: RESIZE_ZONE_PX,
    right: RESIZE_ZONE_PX,
    height: RESIZE_ZONE_PX,
    cursor: "ns-resize",
  },
  left: {
    ...base,
    left: 0,
    top: RESIZE_ZONE_PX,
    bottom: RESIZE_ZONE_PX,
    width: RESIZE_ZONE_PX,
    cursor: "ew-resize",
  },
  right: {
    ...base,
    right: 0,
    top: RESIZE_ZONE_PX,
    bottom: RESIZE_ZONE_PX,
    width: RESIZE_ZONE_PX,
    cursor: "ew-resize",
  },
  topLeft: {
    ...base,
    top: 0,
    left: 0,
    width: RESIZE_ZONE_PX,
    height: RESIZE_ZONE_PX,
    cursor: "nwse-resize",
  },
  topRight: {
    ...base,
    top: 0,
    right: 0,
    width: RESIZE_ZONE_PX,
    height: RESIZE_ZONE_PX,
    cursor: "nesw-resize",
  },
  bottomLeft: {
    ...base,
    bottom: 0,
    left: 0,
    width: RESIZE_ZONE_PX,
    height: RESIZE_ZONE_PX,
    cursor: "nesw-resize",
  },
  bottomRight: {
    ...base,
    bottom: 0,
    right: 0,
    width: RESIZE_ZONE_PX,
    height: RESIZE_ZONE_PX,
    cursor: "nwse-resize",
  },
};

function PopoutResizeZones() {
  return (
    <>
      <div style={styles.top} data-testid="popout-resize-top" aria-hidden="true" />
      <div style={styles.bottom} data-testid="popout-resize-bottom" aria-hidden="true" />
      <div style={styles.left} data-testid="popout-resize-left" aria-hidden="true" />
      <div style={styles.right} data-testid="popout-resize-right" aria-hidden="true" />
      <div style={styles.topLeft} data-testid="popout-resize-top-left" aria-hidden="true" />
      <div style={styles.topRight} data-testid="popout-resize-top-right" aria-hidden="true" />
      <div style={styles.bottomLeft} data-testid="popout-resize-bottom-left" aria-hidden="true" />
      <div style={styles.bottomRight} data-testid="popout-resize-bottom-right" aria-hidden="true" />
    </>
  );
}

export default PopoutResizeZones;
