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
  /** Leave the player route entirely (X icon, top-right). */
  onExit: () => void;
  /**
   * Navigate to the previous queue item / Plex episode (chevron-left, top-left).
   * Omit when no previous item exists; the button is hidden.
   */
  onPrevious?: () => void;
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
  /** Queue */
  queueCount?: number;
  onToggleQueue?: () => void;
  /** Subtitle search */
  serverUri?: string;
  serverToken?: string;
  ratingKey?: string;
  onSubtitleDownloaded?: () => void;
}

function PlayerControls({ player, onExit, onPrevious, visible, syncIndicator, chapters, onSeek, onActivity, onNextEpisode, onPrevEpisode, audioEnhancements, onAudioEnhancementChange, isPiPActive, isPiPSupported, onTogglePiP, queueCount, onToggleQueue, serverUri, serverToken, ratingKey, onSubtitleDownloaded }: PlayerControlsProps) {
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
        {/* Previous button — only shown when there's actually a previous
            item to go to (queue or episode-nav). Otherwise the title sits
            flush with the layout grid where the button would be. */}
        {onPrevious ? (
          <button
            onClick={onPrevious}
            style={styles.backButton}
            aria-label="Previous"
            title="Previous"
          >
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
        ) : (
          <span style={styles.backButtonPlaceholder} aria-hidden="true" />
        )}
        <div style={styles.titleArea}>
          <span style={styles.titleText}>{player.title}</span>
          <span style={styles.subtitleText}>
            {player.duration > 0 && formatDurationLabel(player.duration)}
            {player.subtitle && player.duration > 0 && " · "}
            {player.subtitle}
          </span>
        </div>
        {/* Exit button — always present so the user has an unambiguous way
            to leave the player. ESC also fires onExit via the keyboard
            shortcut hook. */}
        <button
          onClick={onExit}
          style={styles.exitButton}
          aria-label="Exit"
          title="Exit"
        >
          <svg
            aria-hidden="true"
            width={22}
            height={22}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1={18} y1={6} x2={6} y2={18} />
            <line x1={6} y1={6} x2={18} y2={18} />
          </svg>
        </button>
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
        queueCount={queueCount}
        onToggleQueue={onToggleQueue}
        serverUri={serverUri}
        serverToken={serverToken}
        ratingKey={ratingKey}
        onSubtitleDownloaded={onSubtitleDownloaded}
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
  // Reserves the same horizontal slot as backButton so the title doesn't jump
  // when the Previous button toggles in/out across episodes.
  backButtonPlaceholder: {
    width: "30px",
    height: "30px",
    display: "inline-block",
    flexShrink: 0,
  },
  exitButton: {
    background: "transparent",
    color: "#fff",
    padding: "0.25rem",
    display: "flex",
    alignItems: "center",
    marginLeft: "auto",
  },
  titleArea: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    overflow: "hidden",
    flex: 1,
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
