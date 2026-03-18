/**
 * Video player overlay controls — seek bar, play/pause, volume,
 * fullscreen, and track selection buttons.
 */

import type { UsePlayerResult } from "../hooks/usePlayer";
import type { AudioEnhancementsResult } from "../hooks/useAudioEnhancements";
import type { NormalizationPreset } from "../types/preferences";
import type { PlexChapter } from "../types/library";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { useSeekBar } from "../hooks/useSeekBar";
import { formatDurationLabel } from "../utils/time-format";
import ControlsBottomBar from "./player/ControlsBottomBar";

interface PlayerControlsProps {
  player: UsePlayerResult;
  onBack: () => void;
  visible: boolean;
  syncIndicator?: React.ReactNode;
  chapters?: PlexChapter[];
  onSeek?: (time: number) => void;
  /** Called on any user interaction to keep controls visible */
  onActivity?: () => void;
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
  audioEnhancements?: AudioEnhancementsResult;
  onAudioEnhancementChange?: (changes: {
    volumeBoost?: number;
    normalizationPreset?: NormalizationPreset;
    audioOffsetMs?: number;
  }) => void;
  /** Picture-in-Picture */
  isPiPActive?: boolean;
  isPiPSupported?: boolean;
  onTogglePiP?: () => void;
}

function PlayerControls({ player, onBack, visible, syncIndicator, chapters, onSeek, onActivity, onNextEpisode, onPrevEpisode, audioEnhancements, onAudioEnhancementChange, isPiPActive, isPiPSupported, onTogglePiP }: PlayerControlsProps) {
  const bp = useBreakpoint();
  const mobile = isMobile(bp);

  // Use WT-aware seek when provided, otherwise fall back to player.seek
  const seekFn = onSeek ?? player.seek;

  const seekBar = useSeekBar({
    duration: player.duration,
    currentTime: player.currentTime,
    buffered: player.buffered,
    seek: seekFn,
    onActivity,
  });

  return (
    <div
      style={{
        ...styles.container,
        opacity: visible || seekBar.isDragging ? 1 : 0,
      }}
    >
      {/* Top gradient + title bar */}
      <div style={{
        ...styles.topBar,
        pointerEvents: visible ? "auto" : "none",
      }}>
        <button onClick={onBack} style={styles.backButton} aria-label="Back">
          <svg
            aria-hidden="true"
            width={24}
            height={24}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div style={styles.titleArea}>
          <span style={styles.titleText}>{player.title}</span>
          <span style={styles.subtitleText}>
            {player.duration > 0 && formatDurationLabel(player.duration)}
            {player.subtitle && player.duration > 0 && " · "}
            {player.subtitle}
          </span>
        </div>
      </div>

      {/* Bottom controls (seek bar + transport + utility buttons + menus) */}
      <ControlsBottomBar
        player={player}
        seekBar={seekBar}
        seekFn={seekFn}
        visible={visible}
        mobile={mobile}
        syncIndicator={syncIndicator}
        chapters={chapters}
        onActivity={onActivity}
        onNextEpisode={onNextEpisode}
        onPrevEpisode={onPrevEpisode}
        audioEnhancements={audioEnhancements}
        onAudioEnhancementChange={onAudioEnhancementChange}
        isPiPActive={isPiPActive}
        isPiPSupported={isPiPSupported}
        onTogglePiP={onTogglePiP}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    transition: "opacity 0.3s ease",
    zIndex: 10,
    pointerEvents: "none",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "1rem 1.25rem",
    background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)",
  },
  backButton: {
    background: "transparent",
    color: "#fff",
    padding: "0.25rem",
    display: "flex",
    alignItems: "center",
  },
  titleArea: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    overflow: "hidden",
  },
  titleText: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "#fff",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  subtitleText: {
    fontSize: "0.82rem",
    color: "rgba(255,255,255,0.7)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
};

export default PlayerControls;
