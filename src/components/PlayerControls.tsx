/**
 * Video player overlay controls — seek bar, play/pause, volume,
 * fullscreen, and track selection buttons.
 */

import { useState, useRef, useCallback } from "react";
import type { UsePlayerResult } from "../hooks/usePlayer";
import type { AudioEnhancementsResult } from "../hooks/useAudioEnhancements";
import type { NormalizationPreset } from "../types/preferences";
import type { PlexChapter } from "../types/library";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { useHoldToSkip } from "../hooks/useHoldToSkip";
import { formatTime, formatDurationLabel, getEndsAt } from "../utils/time-format";
import TrackMenu from "./TrackMenu";
import AudioEnhancementsPanel from "./AudioEnhancementsPanel";

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
}

const SKIP_SECONDS = 10;

function PlayerControls({ player, onBack, visible, syncIndicator, chapters, onSeek, onActivity, onNextEpisode, onPrevEpisode, audioEnhancements, onAudioEnhancementChange }: PlayerControlsProps) {
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
  const [skipIndicator, setSkipIndicator] = useState<string | null>(null);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use WT-aware seek when provided, otherwise fall back to player.seek
  const seekFn = onSeek ?? player.seek;

  // Refs for latest values so hold-to-skip callbacks always read current state
  const seekFnRef = useRef(seekFn);
  seekFnRef.current = seekFn;
  const currentTimeRef = useRef(player.currentTime);
  currentTimeRef.current = player.currentTime;
  const durationRef = useRef(player.duration);
  durationRef.current = player.duration;

  const showSkipIndicator = useCallback((label: string) => {
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    setSkipIndicator(label);
    skipTimerRef.current = setTimeout(() => setSkipIndicator(null), 600);
    onActivity?.();
  }, [onActivity]);

  // Hold-to-accelerate skip hooks — use refs so each tick reads the latest position
  const skipBackward = useHoldToSkip({
    direction: "backward",
    onSkip: useCallback((seconds: number) => {
      seekFnRef.current(Math.max(0, currentTimeRef.current - seconds));
    }, []),
    onSkipLabel: showSkipIndicator,
  });

  const skipForward = useHoldToSkip({
    direction: "forward",
    onSkip: useCallback((seconds: number) => {
      seekFnRef.current(Math.min(durationRef.current, currentTimeRef.current + seconds));
    }, []),
    onSkipLabel: showSkipIndicator,
  });

  // Chapter skip (or 30s fallback)
  const handleChapterSkip = useCallback((direction: "next" | "prev") => {
    if (chapters && chapters.length > 0) {
      const currentMs = player.currentTime * 1000;
      if (direction === "next") {
        const next = chapters.find((c) => c.startTimeOffset > currentMs + 1000);
        if (next) {
          seekFn(next.startTimeOffset / 1000);
          showSkipIndicator(next.tag);
          return;
        }
      } else {
        const sorted = [...chapters].sort((a, b) => b.startTimeOffset - a.startTimeOffset);
        const prev = sorted.find((c) => c.startTimeOffset < currentMs - 2000);
        if (prev) {
          seekFn(prev.startTimeOffset / 1000);
          showSkipIndicator(prev.tag);
          return;
        }
      }
    }
    // Fallback: 30s skip
    const delta = direction === "next" ? 30 : -30;
    const target = Math.max(0, Math.min(player.duration, player.currentTime + delta));
    seekFn(target);
    showSkipIndicator(direction === "next" ? "+30" : "-30");
  }, [chapters, player.currentTime, player.duration, seekFn, showSkipIndicator]);

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
    onActivity?.();
    const time = getSeekTime(e.clientX);
    seekFn(time);

    const handleMouseMove = (ev: MouseEvent) => {
      seekFn(getSeekTime(ev.clientX));
    };
    const handleMouseUp = (ev: MouseEvent) => {
      seekFn(getSeekTime(ev.clientX));
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
    onActivity?.();
    seekFn(getSeekTime(e.touches[0].clientX));
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    seekFn(getSeekTime(e.touches[0].clientX));
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
          <span style={styles.subtitleText}>
            {player.duration > 0 && formatDurationLabel(player.duration)}
            {player.subtitle && player.duration > 0 && " · "}
            {player.subtitle}
          </span>
        </div>
      </div>

      {/* Skip indicator overlay */}
      {skipIndicator && (
        <div style={styles.skipOverlay} key={skipIndicator + Date.now()}>
          <span style={skipIndicator.length > 5 ? styles.skipOverlayChapter : styles.skipOverlayText}>
            {skipIndicator}
          </span>
        </div>
      )}

      {/* Bottom controls */}
      <div style={{
        ...styles.bottomArea,
        pointerEvents: visible || isDragging ? "auto" : "none",
      }}>
        {/* Seek bar with time labels */}
        <div style={styles.seekRow}>
        <span style={styles.seekTimeLabel}>{formatTime(player.currentTime)}</span>
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
        <div style={styles.seekTimeRight}>
          <span style={styles.seekTimeLabel}>
            -{formatTime(player.duration - player.currentTime)}
          </span>
          {player.duration > 0 && (
            <span style={styles.endsAt}>
              Ends {getEndsAt(player.currentTime, player.duration)}
            </span>
          )}
        </div>
        </div>

        {/* Controls row */}
        <div style={styles.controlsRow}>
          {/* Left controls — transport */}
          <div style={{
            ...styles.controlsLeft,
            ...(mobile ? { gap: "0.25rem" } : {}),
          }}>
            {/* Previous episode */}
            {onPrevEpisode && (
              <button
                onClick={onPrevEpisode}
                style={{
                  ...styles.controlButton,
                  ...(mobile ? { padding: "0.5rem" } : {}),
                }}
                aria-label="Previous episode"
              >
                <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="currentColor">
                  <rect x={4} y={5} width={3} height={14} rx={0.5} />
                  <polygon points="18,5 9,12 18,19" />
                </svg>
              </button>
            )}

            {/* Chapter back / 30s */}
            <button
              onClick={() => handleChapterSkip("prev")}
              style={{
                ...styles.controlButton,
                ...(mobile ? { padding: "0.5rem" } : {}),
              }}
              aria-label={chapters && chapters.length > 0 ? "Previous chapter" : "Rewind 30 seconds"}
            >
              <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>

            {/* 10s back — hold to accelerate */}
            <button
              onPointerDown={skipBackward.onPointerDown}
              onPointerUp={skipBackward.onPointerUp}
              onPointerLeave={skipBackward.onPointerUp}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                ...styles.controlButton,
                ...(mobile ? { padding: "0.5rem" } : {}),
              }}
              aria-label={`Rewind ${SKIP_SECONDS} seconds`}
            >
              <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M4 12a8 8 0 1 1 2.3 5.7" />
                <polyline points="4 8 4 12 8 12" />
                <text x="12" y="14.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">10</text>
              </svg>
            </button>

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

            {/* 10s forward — hold to accelerate */}
            <button
              onPointerDown={skipForward.onPointerDown}
              onPointerUp={skipForward.onPointerUp}
              onPointerLeave={skipForward.onPointerUp}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                ...styles.controlButton,
                ...(mobile ? { padding: "0.5rem" } : {}),
              }}
              aria-label={`Forward ${SKIP_SECONDS} seconds`}
            >
              <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M20 12a8 8 0 1 0-2.3 5.7" />
                <polyline points="20 8 20 12 16 12" />
                <text x="12" y="14.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">10</text>
              </svg>
            </button>

            {/* Chapter forward / 30s */}
            <button
              onClick={() => handleChapterSkip("next")}
              style={{
                ...styles.controlButton,
                ...(mobile ? { padding: "0.5rem" } : {}),
              }}
              aria-label={chapters && chapters.length > 0 ? "Next chapter" : "Forward 30 seconds"}
            >
              <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="13 17 18 12 13 7" />
                <polyline points="6 17 11 12 6 7" />
              </svg>
            </button>

            {/* Next episode */}
            {onNextEpisode && (
              <button
                onClick={onNextEpisode}
                style={{
                  ...styles.controlButton,
                  ...(mobile ? { padding: "0.5rem" } : {}),
                }}
                aria-label="Next episode"
              >
                <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6,5 15,12 6,19" />
                  <rect x={17} y={5} width={3} height={14} rx={0.5} />
                </svg>
              </button>
            )}

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
            {/* Watch Together sync indicator */}
            {syncIndicator}

            {/* Subtitle button — always visible */}
            <button
              onClick={() => {
                setSubtitleMenuOpen((o) => !o);
                setAudioMenuOpen(false);
                setEnhancementsOpen(false);
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

            {/* Audio button — always visible */}
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
                  {/* Sliders/mixer icon — 3 vertical tracks with knobs */}
                  <line x1={5} y1={3} x2={5} y2={21} />
                  <circle cx={5} cy={14} r={2.5} fill="currentColor" />
                  <line x1={12} y1={3} x2={12} y2={21} />
                  <circle cx={12} cy={8} r={2.5} fill="currentColor" />
                  <line x1={19} y1={3} x2={19} y2={21} />
                  <circle cx={19} cy={16} r={2.5} fill="currentColor" />
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
    flex: 1,
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
  endsAt: {
    color: "rgba(255,255,255,0.5)",
    fontSize: "0.75rem",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  seekTimeRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.1rem",
    minWidth: "3.5rem",
  },
  skipOverlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 20,
    pointerEvents: "none",
  },
  skipOverlayText: {
    fontSize: "3rem",
    fontWeight: 700,
    color: "rgba(255,255,255,0.85)",
    textShadow: "0 2px 12px rgba(0,0,0,0.6)",
    fontVariantNumeric: "tabular-nums",
  },
  skipOverlayChapter: {
    fontSize: "1.5rem",
    fontWeight: 600,
    color: "rgba(255,255,255,0.9)",
    textShadow: "0 2px 12px rgba(0,0,0,0.6)",
    background: "rgba(0,0,0,0.5)",
    padding: "0.35rem 1rem",
    borderRadius: "8px",
    whiteSpace: "nowrap" as const,
  },
  seekRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "0.5rem",
  },
  seekTimeLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: "0.8rem",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    minWidth: "3.5rem",
    textAlign: "center",
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
