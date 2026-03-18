/**
 * Bottom bar layout — houses the seek bar row and the controls row
 * (transport buttons left, utility buttons right).
 */

import { useState } from "react";
import type { UsePlayerResult } from "../../hooks/usePlayer";
import type { UseSeekBarResult } from "../../hooks/useSeekBar";
import type { AudioEnhancementsResult } from "../../hooks/useAudioEnhancements";
import type { NormalizationPreset } from "../../types/preferences";
import type { PlexChapter } from "../../types/library";
import SeekBar from "./SeekBar";
import SkipButtons from "./SkipButtons";
import TrackMenu from "../TrackMenu";
import AudioEnhancementsPanel from "../AudioEnhancementsPanel";

interface ControlsBottomBarProps {
  player: UsePlayerResult;
  seekBar: UseSeekBarResult;
  seekFn: (time: number) => void;
  visible: boolean;
  mobile: boolean;
  syncIndicator?: React.ReactNode;
  chapters?: PlexChapter[];
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

function ControlsBottomBar({
  player,
  seekBar,
  seekFn,
  visible,
  mobile,
  syncIndicator,
  chapters,
  onActivity,
  onNextEpisode,
  onPrevEpisode,
  audioEnhancements,
  onAudioEnhancementChange,
  isPiPActive,
  isPiPSupported,
  onTogglePiP,
}: ControlsBottomBarProps) {
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [enhancementsOpen, setEnhancementsOpen] = useState(false);

  const iconSmall = mobile ? 26 : 22;
  const iconLarge = mobile ? 32 : 28;

  return (
    <>
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

        {/* Controls row */}
        <div style={styles.controlsRow}>
          {/* Left controls — transport */}
          <div
            style={{
              ...styles.controlsLeft,
              ...(mobile ? { gap: "0.25rem" } : {}),
            }}
          >
            <SkipButtons
              player={player}
              chapters={chapters}
              seekFn={seekFn}
              onActivity={onActivity}
              onNextEpisode={onNextEpisode}
              onPrevEpisode={onPrevEpisode}
              mobile={mobile}
              iconSmall={iconSmall}
              iconLarge={iconLarge}
            />

            {/* Volume — hidden on mobile */}
            {!mobile && (
              <div
                style={styles.volumeContainer}
                onMouseEnter={() => setVolumeOpen(true)}
                onMouseLeave={() => setVolumeOpen(false)}
              >
                <button
                  onClick={player.toggleMute}
                  style={styles.controlButton}
                  aria-label={player.isMuted ? "Unmute" : "Mute"}
                >
                  {player.isMuted || player.volume === 0 ? (
                    <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" />
                      <line x1={23} y1={9} x2={17} y2={15} />
                      <line x1={17} y1={9} x2={23} y2={15} />
                    </svg>
                  ) : (
                    <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" />
                      <path d="M15.54 8.46a5 5 0 010 7.07" />
                      {player.volume > 0.5 && (
                        <path d="M19.07 4.93a10 10 0 010 14.14" />
                      )}
                      {player.volume > 1 && (
                        <path d="M21.07 2.93a14 14 0 010 18.14" stroke="var(--accent)" strokeWidth={1.5} />
                      )}
                    </svg>
                  )}
                </button>
                {volumeOpen && (
                  <div style={styles.volumeSliderContainer}>
                    <input
                      type="range"
                      aria-label="Volume"
                      min={0}
                      max={2}
                      step={0.05}
                      value={player.isMuted ? 0 : player.volume}
                      onChange={(e) => player.setVolume(parseFloat(e.target.value))}
                      style={styles.volumeSlider}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right controls */}
          <div style={styles.controlsRight}>
            {syncIndicator}

            {/* Subtitle button */}
            <button
              onClick={() => {
                setSubtitleMenuOpen((o) => !o);
                setAudioMenuOpen(false);
                setEnhancementsOpen(false);
              }}
              style={{
                ...styles.controlButton,
                ...(player.selectedSubtitleId !== null ? { color: "var(--accent)" } : {}),
              }}
              aria-label="Subtitles"
            >
              <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x={2} y={4} width={20} height={16} rx={2} />
                <line x1={6} y1={12} x2={10} y2={12} />
                <line x1={14} y1={12} x2={18} y2={12} />
                <line x1={6} y1={16} x2={18} y2={16} />
              </svg>
            </button>

            {/* Audio button */}
            <button
              onClick={() => {
                setAudioMenuOpen((o) => !o);
                setSubtitleMenuOpen(false);
                setEnhancementsOpen(false);
              }}
              style={{
                ...styles.controlButton,
                ...(mobile ? { padding: "0.5rem" } : {}),
              }}
              aria-label="Audio"
            >
              <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M9 18V5l12-2v13" />
                <circle cx={6} cy={18} r={3} />
                <circle cx={18} cy={16} r={3} />
              </svg>
            </button>

            {/* Audio Enhancements */}
            {audioEnhancements && !mobile && (
              <button
                onClick={() => {
                  setEnhancementsOpen((o) => !o);
                  setSubtitleMenuOpen(false);
                  setAudioMenuOpen(false);
                }}
                style={{
                  ...styles.controlButton,
                  ...(audioEnhancements.volumeBoost > 1 ||
                  audioEnhancements.normalizationPreset !== "off"
                    ? { color: "var(--accent)" }
                    : {}),
                }}
                aria-label="Audio enhancements"
              >
                <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                  <line x1={5} y1={3} x2={5} y2={21} />
                  <circle cx={5} cy={14} r={2.5} fill="currentColor" />
                  <line x1={12} y1={3} x2={12} y2={21} />
                  <circle cx={12} cy={8} r={2.5} fill="currentColor" />
                  <line x1={19} y1={3} x2={19} y2={21} />
                  <circle cx={19} cy={16} r={2.5} fill="currentColor" />
                </svg>
              </button>
            )}

            {/* Picture-in-Picture */}
            {isPiPSupported && onTogglePiP && (
              <button
                onClick={onTogglePiP}
                style={{
                  ...styles.controlButton,
                  ...(isPiPActive ? { color: "var(--accent)" } : {}),
                  ...(mobile ? { padding: "0.5rem" } : {}),
                }}
                aria-label={isPiPActive ? "Exit picture-in-picture" : "Picture-in-picture"}
              >
                {isPiPActive ? (
                  <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x={2} y={3} width={20} height={14} rx={2} />
                    <rect x={10} y={9} width={8} height={6} rx={1} fill="currentColor" opacity={0.3} />
                    <path d="M18 21H6" />
                  </svg>
                ) : (
                  <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x={2} y={3} width={20} height={14} rx={2} />
                    <rect x={10} y={9} width={8} height={6} rx={1} />
                    <path d="M18 21H6" />
                  </svg>
                )}
              </button>
            )}

            {/* Fullscreen */}
            <button
              onClick={player.toggleFullscreen}
              style={{
                ...styles.controlButton,
                ...(mobile ? { padding: "0.5rem" } : {}),
              }}
              aria-label={player.isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {player.isFullscreen ? (
                <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="4 14 8 14 8 18" />
                  <polyline points="20 10 16 10 16 6" />
                  <polyline points="14 4 14 8 18 8" />
                  <polyline points="10 20 10 16 6 16" />
                </svg>
              ) : (
                <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <polyline points="21 3 14 10" />
                  <polyline points="3 21 10 14" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Track selection menus */}
      {subtitleMenuOpen && (
        <TrackMenu
          label="Subtitles"
          tracks={player.subtitleTracks}
          selectedId={player.selectedSubtitleId}
          onSelect={player.selectSubtitleTrack}
          allowNone={player.subtitleTracks.length > 0}
          emptyMessage="No subtitle tracks available"
          onClose={() => setSubtitleMenuOpen(false)}
        />
      )}

      {audioMenuOpen && (
        <TrackMenu
          label="Audio"
          tracks={player.audioTracks}
          selectedId={player.selectedAudioId}
          onSelect={(id) => {
            if (id !== null) player.selectAudioTrack(id);
          }}
          emptyMessage="No other audio tracks available"
          onClose={() => setAudioMenuOpen(false)}
        />
      )}

      {enhancementsOpen && audioEnhancements && onAudioEnhancementChange && (
        <AudioEnhancementsPanel
          enhancements={audioEnhancements}
          onClose={() => setEnhancementsOpen(false)}
          onPersist={onAudioEnhancementChange}
        />
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bottomArea: {
    display: "flex",
    flexDirection: "column",
    padding: "0 1.25rem 0.75rem",
    background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)",
    paddingTop: "3rem",
  },
  controlsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  controlsLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  controlsRight: {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
  },
  controlButton: {
    background: "transparent",
    color: "var(--text-primary)",
    padding: "0.35rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "4px",
  },
  volumeContainer: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  volumeSliderContainer: {
    display: "flex",
    alignItems: "center",
    marginLeft: "0.25rem",
  },
  volumeSlider: {
    width: "80px",
    height: "4px",
    accentColor: "#e5a00d",
    cursor: "pointer",
  },
};

export default ControlsBottomBar;
