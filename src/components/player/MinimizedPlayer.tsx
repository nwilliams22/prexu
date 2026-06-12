/**
 * Pure presentational wrapper around <MiniChrome> for the minimize-mode
 * branch of Player.tsx.
 *
 * Extracted from Player.tsx (prexu-ps6) — was inline at the early-return
 * branch. Renders the corner-positioned wrapper div + forwards everything
 * to MiniChrome. No logic.
 *
 * Position + size come from PlayerContext.miniRect so the cut-out
 * (AppLayout mask) and this overlay stay in lockstep with the user's
 * chosen corner + size. miniRectToContainerStyle picks the right
 * top/bottom/left/right pair for the anchor corner.
 */

import type React from "react";
import MiniChrome from "./MiniChrome";
import { miniRectToContainerStyle } from "../../utils/mini-rect";
import type { UsePlayerResult } from "../../hooks/usePlayer";
import type { PlayerMinimizeContextValue } from "../../contexts/PlayerContext";
import type { ActiveSegment } from "../../hooks/player/useSkipSegments";

interface MinimizedPlayerProps {
  player: UsePlayerResult;
  /** Narrow minimize-only slice — caller passes `usePlayerMinimize()`
   *  (prexu-ii3 split). Reads `miniRect`, `restoreFromMinimize`, and
   *  `updateMiniRect`. */
  playerMinimize: PlayerMinimizeContextValue;
  togglePlay: () => void;
  seek: (seconds: number) => void;
  onExit: () => void;
  controlsVisible: boolean;
  resetHideTimer: () => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  /** Skip-segment + next-episode plumbing for the mini chrome pill
   *  (prexu-0ru). Sourced from Player.tsx's useSkipSegments + queue
   *  state. All optional — MiniChrome no-ops the pill if not wired. */
  activeSegment?: ActiveSegment | null;
  onSkipSegment?: () => void;
  hasNextItem?: boolean;
  onNextEpisode?: () => void;
}

const containerBase: React.CSSProperties = {
  position: "fixed",
  background: "transparent",
  // overflow: visible lets the resize handle (which sits on the corner
  // opposite the anchor, at an offset of -6,-6) hang slightly outside
  // the mini bounds — it remains hit-testable. The container itself is
  // still bounded by width/height for layout purposes.
  overflow: "visible",
  // High z-index so chrome floats above any underlying routes that may
  // have their own elevated layers (sidebars, modals, etc.).
  zIndex: 1000,
};

export default function MinimizedPlayer({
  player,
  playerMinimize,
  togglePlay,
  seek,
  onExit,
  controlsVisible,
  resetHideTimer,
  handleMouseMove,
  activeSegment,
  onSkipSegment,
  hasNextItem,
  onNextEpisode,
}: MinimizedPlayerProps) {
  const miniRect = playerMinimize.miniRect;
  return (
    <div
      style={{
        ...containerBase,
        ...miniRectToContainerStyle(miniRect),
      }}
    >
      <MiniChrome
        isPlaying={player.isPlaying}
        onTogglePlay={togglePlay}
        onRestore={playerMinimize.restoreFromMinimize}
        onClose={onExit}
        title={player.title ?? undefined}
        visible={controlsVisible}
        onActivity={resetHideTimer}
        onMouseMove={handleMouseMove}
        miniRect={miniRect}
        onUpdateMiniRect={playerMinimize.updateMiniRect}
        currentTime={player.currentTime}
        duration={player.duration}
        onSeek={seek}
        activeSegment={activeSegment}
        onSkipSegment={onSkipSegment}
        hasNextItem={hasNextItem}
        onNextEpisode={onNextEpisode}
      />
    </div>
  );
}
