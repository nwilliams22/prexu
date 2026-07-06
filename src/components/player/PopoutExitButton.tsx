/**
 * Always-reachable exit-popout affordance (prexu-f4o4).
 *
 * Root cause: ControlsBottomBar's right-hand button cluster (subtitles,
 * audio, queue, minimize, pop-out toggle, fullscreen) plus SkipButtons'
 * left-hand transport cluster are plain flex rows with no wrap and no
 * width-based compaction. Their combined min-content width (roughly
 * 500px+ once padding is counted) exceeds even the DEFAULT pop-out size
 * (480x270) — let alone the 200x120 logical floor — so flex items refuse
 * to shrink below their intrinsic width and the trailing buttons overflow
 * past the visible window edge. The pop-out toggle itself sits in that
 * trailing group, so once squeezed off-screen the only way back was to
 * edge-resize the window bigger first (hardware-confirmed, Linux).
 *
 * Rather than reworking ControlsBottomBar's layout/priority rules for
 * every screen size (main + popout + mobile), this renders a small
 * dedicated exit button as a sibling of PopoutDragStrip (prexu-6qz) —
 * same hover-reveal top band, same styling language — so an exit
 * affordance is guaranteed to fit and be reachable at ANY pop-out size,
 * independent of how many buttons the bottom bar is trying to cram in.
 * A 24x24 button trivially fits even the 200x120 floor.
 *
 * Render this only on the native player path while pop-out is active
 * (mirrors PopoutDragStrip's gating in Player.tsx); it has no internal
 * gating so it stays trivially testable.
 */

import type React from "react";

interface PopoutExitButtonProps {
  /** Reveal the button. Wired to the same controls-visible state as
   *  PopoutDragStrip so it fades in/out in lockstep with the rest of the
   *  hover-reveal chrome. */
  visible: boolean;
  /** Exit pop-out mode. Player.tsx wires this to the same togglePopOut
   *  used by ControlsBottomBar's own pop-out button — safe to call
   *  unconditionally here since this component only mounts while
   *  isPopOut is already true (toggling exits). */
  onExit: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    position: "absolute",
    top: 2,
    right: 2,
    // Above PopoutDragStrip's data-tauri-drag-region (zIndex 30) so a
    // click here is captured by the button instead of starting a window
    // move — the two occupy the same top band by design.
    zIndex: 31,
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.55)",
    border: "none",
    borderRadius: 4,
    color: "white",
    padding: 0,
    cursor: "pointer",
    transition: "opacity 0.2s ease",
  },
};

function PopoutExitButton({ visible, onExit }: PopoutExitButtonProps) {
  return (
    <button
      type="button"
      style={{
        ...styles.button,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
      onClick={onExit}
      aria-label="Exit pop-out"
      title="Exit pop-out"
      data-testid="popout-exit-button"
    >
      {/* Same glyph ControlsBottomBar shows for the active pop-out state. */}
      <svg
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x={2} y={3} width={20} height={14} rx={2} />
        <rect x={10} y={9} width={8} height={6} rx={1} fill="currentColor" opacity={0.3} />
        <path d="M18 21H6" />
      </svg>
    </button>
  );
}

export default PopoutExitButton;
