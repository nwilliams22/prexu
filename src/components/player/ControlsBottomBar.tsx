/**
 * Bottom controls row — transport buttons left, utility buttons right,
 * plus the track/enhancement/subtitle popup panels.
 *
 * Memoized over the tick-stable `PlayerChrome` slice: nothing rendered
 * here displays the playhead position, so the whole subtree skips the
 * 4 Hz time-pos re-renders. The seek bar (which does display time) lives
 * in PlayerControls above. Interaction-time position reads (chapter
 * skip, hold-to-skip) go through `currentTimeRef`.
 *
 * Responsive compaction (prexu-52ky): a ResizeObserver on the row measures
 * its own width and drives `computeControlsCompaction` (controlsCompaction.ts)
 * to shrink icons, then collapse the right cluster's secondary buttons into
 * an overflow "more" menu, then finally collapse subtitles too — pop-out and
 * fullscreen are NEVER collapsed so pop-out stays reachable in the row at any
 * width. This measurement is independent of the `reflowTick` prop below (a
 * real ResizeObserver fires on actual DOM size changes regardless of parent
 * re-renders), so it does not reintroduce the 4 Hz time-pos re-renders this
 * component is memoized to avoid.
 */

import { memo, useState, useEffect, useRef, useCallback } from "react";
import type { PlayerChrome } from "../../hooks/usePlayer";
import type { AudioEnhancementsResult } from "../../hooks/useAudioEnhancements";
import type { NormalizationPreset } from "../../types/preferences";
import type { PlexChapter } from "../../types/library";
import SkipButtons from "./SkipButtons";
import TrackMenu from "../TrackMenu";
import AudioEnhancementsPanel from "../AudioEnhancementsPanel";
import SubtitleSearchPanel from "./SubtitleSearchPanel";
import ControlsOverflowMenu, { type ControlsOverflowItem } from "./ControlsOverflowMenu";
import { computeControlsCompaction } from "./controlsCompaction";
import { logger } from "../../services/logger";

interface ControlsBottomBarProps {
  player: PlayerChrome;
  /** Live playhead position, kept fresh by PlayerControls (which re-renders
   *  per time-pos tick). Read at interaction time so this memoized tree
   *  doesn't need `currentTime` as a prop. */
  currentTimeRef: React.RefObject<number>;
  seekFn: (time: number) => void;
  mobile: boolean;
  syncIndicator?: React.ReactNode;
  chapters?: PlexChapter[];
  onActivity?: () => void;
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
  /** Stop button (leftmost transport) — leaves the player route. */
  onStop?: () => void;
  audioEnhancements?: AudioEnhancementsResult;
  onAudioEnhancementChange?: (changes: {
    volumeBoost?: number;
    normalizationPreset?: NormalizationPreset;
    audioOffsetMs?: number;
  }) => void;
  /** Picture-in-Picture (or pop-out on native — same button, different
   *  semantics per platform). On native the aria-label is overridden to
   *  "Pop out" via `isPopOutMode` so the button label matches the
   *  Win32-native floating-window behaviour. */
  isPiPActive?: boolean;
  isPiPSupported?: boolean;
  onTogglePiP?: () => void;
  /** Fullscreen toggle that hides the chrome synchronously before the
   *  resize (prexu-ngsa); falls back to player.toggleFullscreen. */
  onToggleFullscreen?: () => void;
  /** When true, the PiP/Pop-out button shows pop-out semantics ("Pop out"
   *  label and tooltip) instead of browser PiP. Set on the native player
   *  path (7il.4). */
  isPopOutMode?: boolean;
  /** In-window minimize support (7il.4). Currently Windows-only; the
   *  button only renders when both `isMinimizeSupported` and `onMinimize`
   *  are provided so HTML5/macOS paths show only the PiP button. */
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
  /** Fired with true while any popup (track menu, enhancements, subtitle
   *  panel) is open so the parent can pin the controls visible — OS-native
   *  widgets like the color picker emit no mousemove, and the auto-hide
   *  timer would otherwise unmount the popup mid-interaction. */
  onPanelPinChange?: (pinned: boolean) => void;
  /** Viewport-resize nudge counter forwarded from Player.tsx (prexu-0p3 /
   *  prexu-trbl). This component is memoized specifically to skip the 4 Hz
   *  time-pos re-renders (see docblock above), and none of its other props
   *  change on a plain window resize — so without this, a popout-exit/
   *  fullscreen-enter resize never reconciles this subtree and the button
   *  row visually keeps its old (e.g. popout-era) width for seconds until
   *  some unrelated prop happens to change. Rendered as a `data-*` attribute
   *  purely so the tick change is a real DOM mutation, not just an unused
   *  prop — mirrors how Player.tsx's own `data-render-tick` forces its
   *  fixed/absolute root to repaint at the new size. Optional/defaulted so
   *  callers that never resize (most tests) can ignore it. */
  reflowTick?: number;
}

function ControlsBottomBar({
  player,
  currentTimeRef,
  seekFn,
  mobile,
  syncIndicator,
  chapters,
  onActivity,
  onNextEpisode,
  onPrevEpisode,
  onStop,
  audioEnhancements,
  onAudioEnhancementChange,
  isPiPActive,
  isPiPSupported,
  onTogglePiP,
  onToggleFullscreen,
  isPopOutMode,
  isMinimizeSupported,
  isMinimizeActive,
  onMinimize,
  queueCount,
  onToggleQueue,
  serverUri,
  serverToken,
  ratingKey,
  onSubtitleDownloaded,
  onPanelPinChange,
  reflowTick = 0,
}: ControlsBottomBarProps) {
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [enhancementsOpen, setEnhancementsOpen] = useState(false);
  const [subtitleSearchOpen, setSubtitleSearchOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const anyPanelOpen =
    subtitleMenuOpen || audioMenuOpen || enhancementsOpen || subtitleSearchOpen;
  useEffect(() => {
    onPanelPinChange?.(anyPanelOpen);
    return () => onPanelPinChange?.(false);
  }, [anyPanelOpen, onPanelPinChange]);

  // Responsive compaction (prexu-52ky) — measure the row's own width with a
  // ResizeObserver rather than threading pixel values down from Player.tsx,
  // so this stays self-contained and fires on real layout changes even when
  // nothing re-renders this (memoized) subtree from above. `0` means
  // "not measured yet" and is treated as full width (see
  // computeControlsCompaction) so the bar never flashes a compacted layout
  // before the observer reports back.
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      setRowWidth((prev) => {
        if (Math.round(prev) === Math.round(width)) return prev;
        logger.debug("player", "controls bar width changed", { width });
        return width;
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const compaction = computeControlsCompaction(rowWidth);

  useEffect(() => {
    logger.debug("player", "controls compaction level", {
      rowWidth,
      ...compaction,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    compaction.iconCompact,
    compaction.rightOverflow,
    compaction.hideSubtitlesInline,
    compaction.hideTransportExtras,
  ]);

  const baseIconSmall = mobile ? 26 : 22;
  const baseIconLarge = mobile ? 32 : 28;
  const iconSmall = compaction.iconCompact ? Math.max(16, baseIconSmall - 6) : baseIconSmall;
  const iconLarge = compaction.iconCompact ? Math.max(20, baseIconLarge - 6) : baseIconLarge;

  // Auto-close the overflow menu if a resize back to full width removes its
  // trigger button, rather than leaving an orphaned popup only closable via
  // Escape/backdrop-click.
  useEffect(() => {
    if (!compaction.rightOverflow) setMoreMenuOpen(false);
  }, [compaction.rightOverflow]);

  const openSubtitles = useCallback(() => {
    if (serverUri && serverToken && ratingKey) {
      setSubtitleSearchOpen((o) => !o);
    } else {
      setSubtitleMenuOpen((o) => !o);
    }
    setAudioMenuOpen(false);
    setEnhancementsOpen(false);
  }, [serverUri, serverToken, ratingKey]);

  const openAudio = useCallback(() => {
    setAudioMenuOpen((o) => !o);
    setSubtitleMenuOpen(false);
    setEnhancementsOpen(false);
  }, []);

  const openEnhancements = useCallback(() => {
    setEnhancementsOpen((o) => !o);
    setSubtitleMenuOpen(false);
    setAudioMenuOpen(false);
  }, []);

  const activateQueue = useCallback(() => {
    onToggleQueue?.();
    setSubtitleMenuOpen(false);
    setAudioMenuOpen(false);
    setEnhancementsOpen(false);
  }, [onToggleQueue]);

  // Items collapsed into the overflow "more" menu (prexu-52ky). Built every
  // render (cheap — a handful of plain objects) rather than memoized, since
  // this component only re-renders on real state/prop changes, never on the
  // 4 Hz time-pos ticks it's memoized against.
  const overflowItems: ControlsOverflowItem[] = [];

  if (compaction.hideSubtitlesInline) {
    overflowItems.push({
      key: "subtitles",
      label: "Subtitles",
      icon: (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x={2} y={4} width={20} height={16} rx={2} />
          <line x1={6} y1={12} x2={10} y2={12} />
          <line x1={14} y1={12} x2={18} y2={12} />
          <line x1={6} y1={16} x2={18} y2={16} />
        </svg>
      ),
      onClick: openSubtitles,
      active: player.selectedSubtitleId !== null,
    });
  }

  if (compaction.rightOverflow) {
    overflowItems.push({
      key: "audio",
      label: "Audio",
      icon: (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M9 18V5l12-2v13" />
          <circle cx={6} cy={18} r={3} />
          <circle cx={18} cy={16} r={3} />
        </svg>
      ),
      onClick: openAudio,
    });

    if (audioEnhancements && !mobile) {
      overflowItems.push({
        key: "enhancements",
        label: "Audio enhancements",
        icon: (
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <line x1={5} y1={3} x2={5} y2={21} />
            <circle cx={5} cy={14} r={2.5} fill="currentColor" />
            <line x1={12} y1={3} x2={12} y2={21} />
            <circle cx={12} cy={8} r={2.5} fill="currentColor" />
            <line x1={19} y1={3} x2={19} y2={21} />
            <circle cx={19} cy={16} r={2.5} fill="currentColor" />
          </svg>
        ),
        onClick: openEnhancements,
        active:
          audioEnhancements.volumeBoost > 1 ||
          audioEnhancements.normalizationPreset !== "off",
      });
    }

    if (onToggleQueue) {
      overflowItems.push({
        key: "queue",
        label: "Playback queue",
        icon: (
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <line x1={4} y1={6} x2={16} y2={6} />
            <line x1={4} y1={10} x2={16} y2={10} />
            <line x1={4} y1={14} x2={12} y2={14} />
            <line x1={4} y1={18} x2={10} y2={18} />
            <polygon points="16,14 22,17 16,20" fill="currentColor" stroke="none" />
          </svg>
        ),
        onClick: activateQueue,
        badge: queueCount,
      });
    }

    if (isMinimizeSupported && onMinimize) {
      overflowItems.push({
        key: "minimize",
        label: isMinimizeActive ? "Restore from minimize" : "Minimize player to corner",
        icon: (
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x={3} y={3} width={14} height={14} rx={2} />
            <rect x={11} y={11} width={10} height={10} rx={2} fill="currentColor" opacity={0.35} />
          </svg>
        ),
        onClick: onMinimize,
        active: isMinimizeActive,
      });
    }
  }

  return (
    <>
      {/* Controls row */}
      <div
        ref={rowRef}
        style={styles.controlsRow}
        data-reflow-tick={reflowTick}
        data-compact={compaction.iconCompact || undefined}
      >
          {/* Left controls — transport */}
          <div
            style={{
              ...styles.controlsLeft,
              ...(mobile ? { gap: "0.25rem" } : {}),
            }}
          >
            <SkipButtons
              isPlaying={player.isPlaying}
              togglePlay={player.togglePlay}
              duration={player.duration}
              currentTimeRef={currentTimeRef}
              chapters={chapters}
              seekFn={seekFn}
              onActivity={onActivity}
              onNextEpisode={onNextEpisode}
              onPrevEpisode={onPrevEpisode}
              onStop={onStop}
              mobile={mobile}
              iconSmall={iconSmall}
              iconLarge={iconLarge}
              reflowTick={reflowTick}
              hideEpisodeNav={compaction.hideTransportExtras}
              hideChapterNav={compaction.hideTransportExtras}
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

            {/* Subtitle button — opens the full tabbed panel (tracks /
                search / style) directly. The compact TrackMenu is only the
                fallback when no server connection is available (local
                playback) since search needs the server.
                Priority tier 2 (prexu-52ky): collapses into the overflow
                menu only at the deepest compaction tier — pop-out and
                fullscreen (below) never do. */}
            {!compaction.hideSubtitlesInline && (
              <button
                onClick={openSubtitles}
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
            )}

            {/* Audio / enhancements / queue / minimize — priority tier 3
                (prexu-52ky): the first group to collapse into the overflow
                "more" menu as the row narrows. */}
            {!compaction.rightOverflow && (
              <>
                <button
                  onClick={openAudio}
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

                {audioEnhancements && !mobile && (
                  <button
                    onClick={openEnhancements}
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

                {onToggleQueue && (
                  <button
                    onClick={activateQueue}
                    style={{
                      ...styles.controlButton,
                      position: "relative",
                    }}
                    aria-label="Playback queue"
                  >
                    <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <line x1={4} y1={6} x2={16} y2={6} />
                      <line x1={4} y1={10} x2={16} y2={10} />
                      <line x1={4} y1={14} x2={12} y2={14} />
                      <line x1={4} y1={18} x2={10} y2={18} />
                      <polygon points="16,14 22,17 16,20" fill="currentColor" stroke="none" />
                    </svg>
                    {queueCount !== undefined && queueCount > 0 && (
                      <span style={styles.queueBadge}>{queueCount}</span>
                    )}
                  </button>
                )}

                {isMinimizeSupported && onMinimize && (
                  <button
                    onClick={onMinimize}
                    style={{
                      ...styles.controlButton,
                      ...(isMinimizeActive ? { color: "var(--accent)" } : {}),
                      ...(mobile ? { padding: "0.5rem" } : {}),
                    }}
                    aria-label={
                      isMinimizeActive
                        ? "Restore from minimize"
                        : "Minimize player to corner"
                    }
                    title={
                      isMinimizeActive
                        ? "Restore player"
                        : "Minimize player to corner"
                    }
                  >
                    {/* "Window-restore-down" style: small box inside large box */}
                    <svg
                      width={iconSmall}
                      height={iconSmall}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x={3} y={3} width={14} height={14} rx={2} />
                      <rect
                        x={11}
                        y={11}
                        width={10}
                        height={10}
                        rx={2}
                        fill="currentColor"
                        opacity={0.35}
                      />
                    </svg>
                  </button>
                )}
              </>
            )}

            {/* Overflow "more" menu trigger (prexu-52ky) — only rendered once
                the row is narrow enough that something has actually been
                collapsed into it. */}
            {compaction.rightOverflow && (
              <button
                onClick={() => setMoreMenuOpen((o) => !o)}
                style={{
                  ...styles.controlButton,
                  ...(moreMenuOpen ? { color: "var(--accent)" } : {}),
                }}
                aria-label="More controls"
                title="More controls"
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
              >
                <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="currentColor">
                  <circle cx={5} cy={12} r={2} />
                  <circle cx={12} cy={12} r={2} />
                  <circle cx={19} cy={12} r={2} />
                </svg>
              </button>
            )}

            {/* Pop-out (native) / Picture-in-Picture (HTML5) — priority
                tier 1 (prexu-52ky): NEVER collapses. In pop-out mode this
                is the primary action (the only way back to windowed mode
                short of PopoutExitButton's top-overlay affordance), so it
                must always be reachable directly in the row. */}
            {isPiPSupported && onTogglePiP && (
              <button
                onClick={onTogglePiP}
                style={{
                  ...styles.controlButton,
                  ...(isPiPActive ? { color: "var(--accent)" } : {}),
                  ...(mobile ? { padding: "0.5rem" } : {}),
                }}
                aria-label={
                  isPopOutMode
                    ? isPiPActive
                      ? "Exit pop-out"
                      : "Pop out floating player"
                    : isPiPActive
                      ? "Exit picture-in-picture"
                      : "Picture-in-picture"
                }
                title={
                  isPopOutMode
                    ? isPiPActive
                      ? "Exit pop-out"
                      : "Pop out floating player"
                    : isPiPActive
                      ? "Exit picture-in-picture"
                      : "Picture-in-picture"
                }
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

            {/* Fullscreen — priority tier 1 (prexu-52ky), same as pop-out:
                NEVER collapses. */}
            <button
              onClick={onToggleFullscreen ?? player.toggleFullscreen}
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

      {/* Overflow "more" menu (prexu-52ky) — holds whatever the priority
          rules collapsed out of the row at the current width. */}
      {moreMenuOpen && compaction.rightOverflow && (
        <ControlsOverflowMenu
          items={overflowItems}
          onClose={() => setMoreMenuOpen(false)}
        />
      )}

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

      {subtitleSearchOpen && serverUri && serverToken && ratingKey && (
        <SubtitleSearchPanel
          serverUri={serverUri}
          serverToken={serverToken}
          ratingKey={ratingKey}
          subtitleTracks={player.subtitleTracks}
          onSelectTrack={player.selectSubtitleTrack}
          selectedSubtitleId={player.selectedSubtitleId}
          onSubtitleDownloaded={onSubtitleDownloaded ?? (() => {})}
          onClose={() => setSubtitleSearchOpen(false)}
        />
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
  queueBadge: {
    position: "absolute",
    top: "2px",
    right: "0px",
    fontSize: "0.55rem",
    fontWeight: 700,
    background: "var(--accent)",
    color: "#000",
    padding: "0px 4px",
    borderRadius: "6px",
    lineHeight: "1.4",
    pointerEvents: "none",
  },
};

export default memo(ControlsBottomBar);
