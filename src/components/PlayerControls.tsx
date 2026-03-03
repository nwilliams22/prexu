/**
 * Video player overlay controls — seek bar, play/pause, volume,
 * fullscreen, and track selection buttons.
 */

import { useState, useRef } from "react";
import type { UsePlayerResult } from "../hooks/usePlayer";
import type { AudioEnhancementsResult } from "../hooks/useAudioEnhancements";
import type { NormalizationPreset } from "../types/preferences";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import TrackMenu from "./TrackMenu";
import AudioEnhancementsPanel from "./AudioEnhancementsPanel";

interface PlayerControlsProps {
  player: UsePlayerResult;
  onBack: () => void;
  visible: boolean;
  syncIndicator?: React.ReactNode;
  audioEnhancements?: AudioEnhancementsResult;
  onAudioEnhancementChange?: (changes: {
    volumeBoost?: number;
    normalizationPreset?: NormalizationPreset;
    audioOffsetMs?: number;
  }) => void;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function PlayerControls({ player, onBack, visible, syncIndicator, audioEnhancements, onAudioEnhancementChange }: PlayerControlsProps) {
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [enhancementsOpen, setEnhancementsOpen] = useState(false);

  const progressPercent =
    player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;
  const bufferedPercent =
    player.duration > 0 ? (player.buffered / player.duration) * 100 : 0;

  // Icon sizes — larger on mobile for touch
  const iconSmall = mobile ? 26 : 22;
  const iconLarge = mobile ? 32 : 28;

  // ── Seek bar interaction ──
  const getSeekTime = (clientX: number): number => {
    const bar = seekBarRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * player.duration;
  };

  const handleSeekMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const time = getSeekTime(e.clientX);
    player.seek(time);

    const handleMouseMove = (ev: MouseEvent) => {
      player.seek(getSeekTime(ev.clientX));
    };
    const handleMouseUp = (ev: MouseEvent) => {
      player.seek(getSeekTime(ev.clientX));
      setIsDragging(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleSeekHover = (e: React.MouseEvent) => {
    const time = getSeekTime(e.clientX);
    setHoverTime(time);
    const bar = seekBarRef.current;
    if (bar) {
      const rect = bar.getBoundingClientRect();
      setHoverX(e.clientX - rect.left);
    }
  };

  // ── Touch seek handlers (mobile) ──
  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    player.seek(getSeekTime(e.touches[0].clientX));
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    player.seek(getSeekTime(e.touches[0].clientX));
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  return (
    <div
      style={{
        ...styles.container,
        opacity: visible || isDragging ? 1 : 0,
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
          {player.subtitle && (
            <span style={styles.subtitleText}>{player.subtitle}</span>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div style={{
        ...styles.bottomArea,
        pointerEvents: visible || isDragging ? "auto" : "none",
      }}>
        {/* Seek bar */}
        <div
          ref={seekBarRef}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.floor(player.duration)}
          aria-valuenow={Math.floor(player.currentTime)}
          aria-valuetext={formatTime(player.currentTime)}
          tabIndex={0}
          style={{
            ...styles.seekBarContainer,
            ...(mobile ? { height: "32px" } : {}),
          }}
          onMouseDown={handleSeekMouseDown}
          onMouseMove={handleSeekHover}
          onMouseLeave={() => setHoverTime(null)}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Buffered range */}
          <div
            style={{
              ...styles.seekBarBuffered,
              width: `${bufferedPercent}%`,
            }}
          />
          {/* Progress */}
          <div
            style={{
              ...styles.seekBarProgress,
              width: `${progressPercent}%`,
            }}
          />
          {/* Thumb */}
          <div
            style={{
              ...styles.seekBarThumb,
              left: `${progressPercent}%`,
              ...(mobile ? { width: "20px", height: "20px", marginTop: "-10px", marginLeft: "-10px" } : {}),
            }}
          />
          {/* Hover tooltip */}
          {hoverTime !== null && (
            <div
              style={{
                ...styles.seekTooltip,
                left: `${hoverX}px`,
              }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Controls row */}
        <div style={styles.controlsRow}>
          {/* Left controls */}
          <div style={styles.controlsLeft}>
            {/* Play / Pause */}
            <button
              onClick={player.togglePlay}
              style={{
                ...styles.controlButton,
                ...(mobile ? { padding: "0.5rem" } : {}),
              }}
              aria-label={player.isPlaying ? "Pause" : "Play"}
            >
              {player.isPlaying ? (
                <svg width={iconLarge} height={iconLarge} viewBox="0 0 24 24" fill="currentColor">
                  <rect x={6} y={4} width={4} height={16} rx={1} />
                  <rect x={14} y={4} width={4} height={16} rx={1} />
                </svg>
              ) : (
                <svg width={iconLarge} height={iconLarge} viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6,4 20,12 6,20" />
                </svg>
              )}
            </button>

            {/* Volume — hidden on mobile (hardware volume used instead) */}
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
                  </svg>
                )}
              </button>
              {volumeOpen && (
                <div style={styles.volumeSliderContainer}>
                  <input
                    type="range"
                    aria-label="Volume"
                    min={0}
                    max={1}
                    step={0.05}
                    value={player.isMuted ? 0 : player.volume}
                    onChange={(e) => player.setVolume(parseFloat(e.target.value))}
                    style={styles.volumeSlider}
                  />
                </div>
              )}
            </div>
            )}

            {/* Time display */}
            <span style={styles.timeDisplay}>
              {formatTime(player.currentTime)} / {formatTime(player.duration)}
            </span>
          </div>

          {/* Right controls */}
          <div style={styles.controlsRight}>
            {/* Watch Together sync indicator */}
            {syncIndicator}

            {/* Subtitle button */}
            {player.subtitleTracks.length > 0 && (
              <button
                onClick={() => {
                  setSubtitleMenuOpen((o) => !o);
                  setAudioMenuOpen(false);
                }}
                style={{
                  ...styles.controlButton,
                  ...(player.selectedSubtitleId !== null
                    ? { color: "var(--accent)" }
                    : {}),
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
            )}

            {/* Audio button */}
            {player.audioTracks.length > 1 && (
              <button
                onClick={() => {
                  setAudioMenuOpen((o) => !o);
                  setSubtitleMenuOpen(false);
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
            )}

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
                <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <rect x={4} y={2} width={3} height={20} rx={1} />
                  <rect x={10.5} y={6} width={3} height={12} rx={1} />
                  <rect x={17} y={4} width={3} height={16} rx={1} />
                </svg>
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
          allowNone
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
    pointerEvents: "none", // clicks pass through to video underneath
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
  bottomArea: {
    display: "flex",
    flexDirection: "column",
    padding: "0 1.25rem 0.75rem",
    background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)",
    paddingTop: "3rem",
  },

  // Seek bar
  seekBarContainer: {
    position: "relative",
    height: "20px",
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    marginBottom: "0.5rem",
  },
  seekBarBuffered: {
    position: "absolute",
    top: "50%",
    left: 0,
    height: "4px",
    marginTop: "-2px",
    background: "rgba(255,255,255,0.25)",
    borderRadius: "2px",
    pointerEvents: "none",
  },
  seekBarProgress: {
    position: "absolute",
    top: "50%",
    left: 0,
    height: "4px",
    marginTop: "-2px",
    background: "var(--accent)",
    borderRadius: "2px",
    pointerEvents: "none",
  },
  seekBarThumb: {
    position: "absolute",
    top: "50%",
    width: "14px",
    height: "14px",
    marginTop: "-7px",
    marginLeft: "-7px",
    background: "var(--accent)",
    borderRadius: "50%",
    pointerEvents: "none",
    boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
  },
  seekTooltip: {
    position: "absolute",
    bottom: "22px",
    transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.85)",
    color: "var(--text-primary)",
    fontSize: "0.75rem",
    padding: "2px 6px",
    borderRadius: "3px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },

  // Controls row
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
  timeDisplay: {
    color: "rgba(255,255,255,0.9)",
    fontSize: "0.85rem",
    fontVariantNumeric: "tabular-nums",
    marginLeft: "0.25rem",
    whiteSpace: "nowrap",
  },

  // Volume
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

export default PlayerControls;
