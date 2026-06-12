/**
 * Video player overlay controls — seek bar, play/pause, volume,
 * fullscreen, and track selection buttons.
 */

import { useState } from "react";
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
  /** Leave the player route entirely. Wired to the bottom-bar Stop button
   *  (square icon) and the ESC keyboard shortcut. */
  onExit: () => void;
  /** Navigate to the previous queue item / Plex episode (chevron-left,
   *  top-left). Omit when no previous item exists; the button is hidden. */
  onPrevious?: () => void;
  visible: boolean;
  /** Skip the opacity fade transition. Set while the window is actively
   *  resizing so the chrome (and its dark gradient) disappears instantly
   *  rather than lingering through a 300ms fade over the resizing video. */
  suppressTransition?: boolean;
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
  /** Picture-in-Picture (or pop-out on native). See ControlsBottomBar
   *  for the `isPopOutMode` semantics. */
  isPiPActive?: boolean;
  isPiPSupported?: boolean;
  onTogglePiP?: () => void;
  isPopOutMode?: boolean;
  /** In-window minimize (7il.4). Windows-only for now; HTML5 path leaves
   *  the props undefined so the button doesn't render. */
  isMinimizeSupported?: boolean;
  isMinimizeActive?: boolean;
  onMinimize?: () => void;
  /** Queue */
  queueCount?: number;
  onToggleQueue?: () => void;
  /** Subtitle search */
  serverUri?: string;
  serverToken?: string;
  ratingKey?: string;
  onSubtitleDownloaded?: () => void;
  /** True while any bottom-bar popup is open — pins controls visible. */
  onPanelPinChange?: (pinned: boolean) => void;
}

function PlayerControls({ player, onExit, onPrevious, visible, suppressTransition, syncIndicator, chapters, onSeek, onActivity, onNextEpisode, onPrevEpisode, audioEnhancements, onAudioEnhancementChange, isPiPActive, isPiPSupported, onTogglePiP, isPopOutMode, isMinimizeSupported, isMinimizeActive, onMinimize, queueCount, onToggleQueue, serverUri, serverToken, ratingKey, onSubtitleDownloaded, onPanelPinChange }: PlayerControlsProps) {
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const [previousHovered, setPreviousHovered] = useState(false);

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
        ...(suppressTransition ? { transition: "none" } : {}),
      }}
    >
      {/* Top gradient + title bar */}
      <div style={{
        ...styles.topBar,
        pointerEvents: visible ? "auto" : "none",
      }}>
        {/* Previous button — only shown when there's actually a previous
            item to go to (queue or episode-nav). The button expands inline
            on hover to reveal a "Previous" label rather than relying on a
            browser tooltip; the label has its own opacity/max-width
            transitions so the chevron stays put while the text slides in. */}
        {onPrevious ? (
          <button
            onClick={onPrevious}
            style={styles.backButton}
            aria-label="Previous"
            onMouseEnter={() => setPreviousHovered(true)}
            onMouseLeave={() => setPreviousHovered(false)}
            onFocus={() => setPreviousHovered(true)}
            onBlur={() => setPreviousHovered(false)}
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
            <span
              style={{
                ...styles.backButtonLabel,
                ...(previousHovered ? styles.backButtonLabelOpen : {}),
              }}
              aria-hidden="true"
            >
              Previous
            </span>
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
        onStop={onExit}
        audioEnhancements={audioEnhancements}
        onAudioEnhancementChange={onAudioEnhancementChange}
        isPiPActive={isPiPActive}
        isPiPSupported={isPiPSupported}
        onTogglePiP={onTogglePiP}
        isPopOutMode={isPopOutMode}
        isMinimizeSupported={isMinimizeSupported}
        isMinimizeActive={isMinimizeActive}
        onMinimize={onMinimize}
        queueCount={queueCount}
        onToggleQueue={onToggleQueue}
        serverUri={serverUri}
        serverToken={serverToken}
        ratingKey={ratingKey}
        onSubtitleDownloaded={onSubtitleDownloaded}
        onPanelPinChange={onPanelPinChange}
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
    padding: "0.25rem 0.5rem",
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    borderRadius: "6px",
    cursor: "pointer",
  },
  // Inline expanding label. Closed state: collapsed width with hidden text;
  // hovered state: max-width animates open and the text fades in. Using
  // max-width (not width) lets us transition between collapsed-to-content
  // without measuring; padding/margin transitions keep the layout smooth.
  backButtonLabel: {
    fontSize: "0.85rem",
    fontWeight: 500,
    color: "#fff",
    overflow: "hidden",
    whiteSpace: "nowrap",
    maxWidth: 0,
    opacity: 0,
    marginLeft: 0,
    transition: "max-width 0.18s ease, opacity 0.15s ease, margin-left 0.18s ease",
  },
  backButtonLabelOpen: {
    maxWidth: "100px",
    opacity: 1,
    marginLeft: "0.15rem",
  },
  // Reserves the same horizontal slot as backButton so the title doesn't jump
  // when the Previous button toggles in/out across episodes.
  backButtonPlaceholder: {
    width: "30px",
    height: "30px",
    display: "inline-block",
    flexShrink: 0,
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
