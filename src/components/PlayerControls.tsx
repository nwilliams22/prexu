/**
 * Video player overlay controls — seek bar, play/pause, volume,
 * fullscreen, and track selection buttons.
 */

import { useRef, useState } from "react";
import type { UsePlayerResult } from "../hooks/usePlayer";
import type { AudioEnhancementsResult } from "../hooks/useAudioEnhancements";
import type { NormalizationPreset } from "../types/preferences";
import type { PlexChapter } from "../types/library";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { useSeekBar } from "../hooks/useSeekBar";
import { formatDurationLabel } from "../utils/time-format";
import ControlsBottomBar from "./player/ControlsBottomBar";
import SeekBar from "./player/SeekBar";

/** Picture-in-Picture (or pop-out on native). See ControlsBottomBar
 *  for the `isPopOutMode` semantics. */
interface PiPProps {
  isActive?: boolean;
  isSupported?: boolean;
  onToggle?: () => void;
  isPopOutMode?: boolean;
}

/** In-window minimize (7il.4). Windows-only for now; HTML5 path leaves
 *  this object undefined so the button doesn't render. */
interface MinimizeProps {
  isSupported?: boolean;
  isActive?: boolean;
  onMinimize?: () => void;
}

interface QueueProps {
  count?: number;
  onToggle?: () => void;
}

interface SubtitleSearchProps {
  serverUri?: string;
  serverToken?: string;
  ratingKey?: string;
  onDownloaded?: () => void;
}

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
  pip?: PiPProps;
  minimize?: MinimizeProps;
  queue?: QueueProps;
  subtitleSearch?: SubtitleSearchProps;
  /** True while any bottom-bar popup is open — pins controls visible. */
  onPanelPinChange?: (pinned: boolean) => void;
  /** Bumped by Player.tsx's viewport-resize ResizeObserver (prexu-0p3).
   *  ControlsBottomBar is memoized over tick-stable props so it skips the
   *  4 Hz time-pos churn — but that also means it never notices a plain
   *  viewport resize (popout-exit, fullscreen-enter) on its own. Forwarding
   *  this defeats that memo just for real resizes, forcing a DOM commit in
   *  its subtree so the WebView repaints it at the new size instead of
   *  leaving it stale for seconds (prexu-trbl). Optional/defaulted so
   *  existing test harnesses that don't care about resize don't need to
   *  wire it up. */
  reflowTick?: number;
}

function PlayerControls({ player, onExit, onPrevious, visible, suppressTransition, syncIndicator, chapters, onSeek, onActivity, onNextEpisode, onPrevEpisode, audioEnhancements, onAudioEnhancementChange, pip, minimize, queue, subtitleSearch, onPanelPinChange, reflowTick = 0 }: PlayerControlsProps) {
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

  // Live playhead position for interaction-time reads (chapter skip,
  // hold-to-skip). This component re-renders on every time-pos tick (it
  // owns the seek bar), so the ref stays fresh — while the memoized
  // ControlsBottomBar/SkipButtons tree below it does not re-render and
  // reads the position through the ref instead of a prop.
  const currentTimeRef = useRef(player.currentTime);
  currentTimeRef.current = player.currentTime;

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

      {/* Bottom controls. The seek bar renders here — it genuinely
          displays time and re-renders with this component on every
          time-pos tick. ControlsBottomBar (buttons + menus) is memoized
          over the tick-stable chrome slice so it skips those ticks. */}
      <div
        style={{
          ...styles.bottomArea,
          pointerEvents: visible || seekBar.isDragging ? "auto" : "none",
        }}
      >
        <SeekBar
          seekBar={seekBar}
          currentTime={player.currentTime}
          duration={player.duration}
          mobile={mobile}
        />
        <ControlsBottomBar
          player={player.chrome}
          currentTimeRef={currentTimeRef}
          seekFn={seekFn}
          mobile={mobile}
          syncIndicator={syncIndicator}
          chapters={chapters}
          onActivity={onActivity}
          onNextEpisode={onNextEpisode}
          onPrevEpisode={onPrevEpisode}
          onStop={onExit}
          audioEnhancements={audioEnhancements}
          onAudioEnhancementChange={onAudioEnhancementChange}
          isPiPActive={pip?.isActive}
          isPiPSupported={pip?.isSupported}
          onTogglePiP={pip?.onToggle}
          isPopOutMode={pip?.isPopOutMode}
          isMinimizeSupported={minimize?.isSupported}
          isMinimizeActive={minimize?.isActive}
          onMinimize={minimize?.onMinimize}
          queueCount={queue?.count}
          onToggleQueue={queue?.onToggle}
          serverUri={subtitleSearch?.serverUri}
          serverToken={subtitleSearch?.serverToken}
          ratingKey={subtitleSearch?.ratingKey}
          onSubtitleDownloaded={subtitleSearch?.onDownloaded}
          onPanelPinChange={onPanelPinChange}
          reflowTick={reflowTick}
        />
      </div>
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
  bottomArea: {
    display: "flex",
    flexDirection: "column",
    padding: "0 1.25rem 0.75rem",
    background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)",
    paddingTop: "3rem",
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
