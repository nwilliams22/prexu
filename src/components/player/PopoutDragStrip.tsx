/**
 * Hover-reveal drag handle for the borderless pop-out player (prexu-6qz).
 *
 * The native pop-out window drops its OS title bar (Rust strips WS_CAPTION),
 * so there's no caption to grab. This slim `data-tauri-drag-region` strip
 * lets the user drag the floating player by its body. It stays fully
 * transparent — preserving the clean mini-player look — until `visible`
 * flips true, which the caller drives off the same controls auto-hide state
 * (`controlsVisible`) as the rest of the chrome. Resize is unaffected: the
 * Rust side keeps WS_THICKFRAME so the window edges still drag-resize.
 *
 * Render this only on the native player path while pop-out is active; it has
 * no internal gating so it stays trivially testable.
 */

import type React from "react";
import { playerStyles as styles } from "../../pages/Player.styles";

interface PopoutDragStripProps {
  /** Reveal the strip. Wire to the player's controls-visible state so the
   *  handle fades in on pointer activity and hides when controls auto-hide. */
  visible: boolean;
}

/**
 * Suppress the browser text-selection that a mousedown would otherwise start.
 *
 * Tauri's data-tauri-drag-region hands the drag to the OS window-move loop,
 * which captures the mouse — so the WebView never sees the matching mouseup.
 * Without this, the selection the mousedown began stays "stuck" and ends up
 * highlighting the whole route once the player unmounts (prexu-6qz follow-up).
 * Mirrors the lockTextSelection guard in useDragGesture.
 */
function suppressSelection(e: React.MouseEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  window.getSelection?.()?.removeAllRanges?.();
}

function PopoutDragStrip({ visible }: PopoutDragStripProps) {
  return (
    <div
      data-tauri-drag-region
      data-testid="popout-drag-strip"
      onMouseDown={suppressSelection}
      style={{
        ...styles.popoutDragStrip,
        opacity: visible ? 1 : 0,
        // Disabled while hidden so the strip never blocks the click-target
        // (play/pause) underneath when the user isn't reaching for it.
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div style={styles.popoutDragGrip} />
    </div>
  );
}

export default PopoutDragStrip;
