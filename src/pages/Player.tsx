/**
 * Full-page video player overlay.
 *
 * Mounted by PlayerOverlay (App.tsx) when PlayerContext has an active
 * session — never rendered as a route directly. Position-fixed full
 * viewport, so it visually replaces whatever's underneath while open
 * and instantly reveals it on stop.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  usePlayerSession,
  usePlayerMinimize,
  type PlayerWatchTogether,
} from "../contexts/PlayerContext";
import { getImageUrl } from "../services/plex-library";
import { usePlayer, IS_NATIVE_PLAYER } from "../hooks/usePlayer";
import { useWatchTogether } from "../hooks/useWatchTogether";
import { useAudioEnhancements } from "../hooks/useAudioEnhancements";
import { usePreferences } from "../hooks/usePreferences";
import { useSkipSegments, clampSkipTarget } from "../hooks/player/useSkipSegments";
import { useShowCreditsLength } from "../hooks/player/useShowCreditsLength";
import { usePlayerControlsVisibility } from "../hooks/player/usePlayerControlsVisibility";
import { useVideoClickHandling } from "../hooks/player/useVideoClickHandling";
import { useEpisodeNavigation } from "../hooks/player/useEpisodeNavigation";
import { useQueueAutoPopulate } from "../hooks/player/useQueueAutoPopulate";
import { useQueue } from "../contexts/QueueContext";
import { useNextEpisodeDetection } from "../hooks/player/useNextEpisodeDetection";
import { usePlayerKeyboardShortcuts } from "../hooks/player/usePlayerKeyboardShortcuts";
import { usePictureInPicture } from "../hooks/player/usePictureInPicture";
import { usePopOutPlayer } from "../hooks/player/usePopOutPlayer";
import { usePlayerLifecycle } from "../hooks/player/usePlayerLifecycle";
import { usePostPlay } from "../hooks/player/usePostPlay";
import PlayerControls from "../components/PlayerControls";
import ParticipantOverlay from "../components/ParticipantOverlay";
import SyncIndicator from "../components/SyncIndicator";
import NextEpisodePrompt from "../components/NextEpisodePrompt";
import ErrorOverlay from "../components/player/ErrorOverlay";
import SkipSegmentButton from "../components/player/SkipSegmentButton";
import QueuePanel from "../components/player/QueuePanel";
import PostPlayScreen from "../components/player/PostPlayScreen";
import KeyboardShortcutsOverlay from "../components/player/KeyboardShortcutsOverlay";
import MinimizedPlayer from "../components/player/MinimizedPlayer";
import type { NormalizationPreset } from "../types/preferences";
import { logger } from "../services/logger";
import { hasNextItem as computeHasNextItem } from "./player-postplay-gate";
import {
  derivePostPlayDetailProps,
  deriveUpNextSlice,
} from "./player-postplay-props";
import { playerStyles as styles } from "./Player.styles";

interface PlayerProps {
  ratingKey: string;
  /** ?offset=N override — null means use saved viewOffset. */
  offset: number | null;
  /** Watch Together session info — undefined for solo playback. */
  watchTogether?: PlayerWatchTogether;
}

function Player({ ratingKey, offset, watchTogether }: PlayerProps) {
  const { isAuthenticated, serverSelected, server } = useAuth();
  const playerSession = usePlayerSession();
  const playerMinimize = usePlayerMinimize();

  const player = usePlayer(ratingKey, offset);

  // Watch Together — derive props from the session bundle (was previously
  // pulled from URL query params). useWatchTogether tolerates null inputs
  // for solo playback.
  const wt = useWatchTogether(
    player,
    watchTogether?.sessionId ?? null,
    watchTogether?.isHost ?? false,
    watchTogether?.relayUrl ?? null,
  );

  const { preferences, updatePreferences } = usePreferences();
  const pb = preferences.playback;

  // Subtitle styling — dispatched to the active backend (native uses libass
  // via invoke + ready-gated retry; HTML5 maintains a <style id="prexu-
  // subtitle-style"> tag with ::cue CSS derived from prefs). Player.tsx
  // doesn't know which is active — the hook contract does.
  //
  // Depend on `applySubtitleStyle` (a stable useCallback) rather than the
  // whole `player` object — `player` is a useMemo whose identity changes
  // on every time-pos tick (currentTime is in its deps). Using `player`
  // here would re-fire this effect ~4 times per second and pump the IPC
  // on every tick, which mpv's gpu-next vo cannot keep up with on the
  // main thread and the video stalls. (prexu-7tk)
  const { applySubtitleStyle } = player;
  useEffect(() => {
    applySubtitleStyle({ size: pb.subtitleSize, style: pb.subtitleStyle });
  }, [applySubtitleStyle, pb.subtitleSize, pb.subtitleStyle]);

  // Body-transparency for the native-mpv path is owned by
  // useTransparentWindow inside PlayerOverlay (see hooks/player/
  // useTransparentWindow.ts).

  // Audio enhancements — Web Audio API processing graph
  const audioEnhancements = useAudioEnhancements(
    player.videoRef,
    pb.volumeBoost,
    pb.normalizationPreset,
    pb.audioOffsetMs,
  );

  const handleAudioEnhancementChange = useCallback(
    (changes: {
      volumeBoost?: number;
      normalizationPreset?: NormalizationPreset;
      audioOffsetMs?: number;
    }) => {
      // Web Audio side — authoritative for HTML5, additional layer on native.
      if (changes.volumeBoost !== undefined) {
        audioEnhancements.setVolumeBoost(changes.volumeBoost);
      }
      if (changes.normalizationPreset !== undefined) {
        audioEnhancements.setNormalizationPreset(changes.normalizationPreset);
      }
      if (changes.audioOffsetMs !== undefined) {
        audioEnhancements.setAudioOffsetMs(changes.audioOffsetMs);
      }
      // Backend IPC bridge — native dispatches to mpv; HTML5 is a no-op.
      player.applyAudioEnhancement({
        normalizationPreset: changes.normalizationPreset,
        audioOffsetMs: changes.audioOffsetMs,
      });
      updatePreferences({ playback: changes });
    },
    [audioEnhancements, updatePreferences, player],
  );

  // Prime the native backend with current audio-enhancement prefs once.
  // useNativePlayer caches the latest applyAudioEnhancement call and
  // flushes it on player://ready, so persisted normalization/delay settings
  // survive cold start. HTML5's applyAudioEnhancement is a no-op (Web
  // Audio constructor args already covered initial values). Only fires
  // on mount — subsequent user changes go through handleAudioEnhancementChange.
  useEffect(() => {
    player.applyAudioEnhancement({
      normalizationPreset: pb.normalizationPreset,
      audioOffsetMs: pb.audioOffsetMs,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only prime
  }, []);

  // Sync main volume's above-1.0 boost to the audio graph's GainNode
  useEffect(() => {
    audioEnhancements.setMainBoost(Math.max(player.volume, 1));
  }, [player.volume, audioEnhancements]);

  // Picture-in-Picture vs pop-out. On the native (mpv) path there's no
  // <video> element so the browser PiP API silently fails — we route the
  // PiP slot to our Win32-native floating pop-out window on Tauri, and
  // to the standard browser PiP everywhere else. The Rust side owns the
  // pop-out geometry (corner + size) and reads it from the persisted
  // store; user-driven resizes round-trip across sessions.
  //
  // The native path has a separate button for in-window minimize (the small
  // corner mode). The two modes are mutually exclusive — `handleMinimize`
  // exits pop-out first when needed, and `togglePiP` exits minimize first.
  const pip = usePictureInPicture(player.videoRef);
  const popOut = usePopOutPlayer();
  const pipActive = IS_NATIVE_PLAYER ? popOut.isPopOut : pip.isPiPActive;
  const pipSupported = IS_NATIVE_PLAYER
    ? popOut.isPopOutSupported
    : pip.isPiPSupported;
  const togglePiP = useCallback(() => {
    if (IS_NATIVE_PLAYER) {
      // Mutual exclusion with minimize: if currently minimized, restore
      // to full first, then pop out.
      if (playerMinimize.isMinimized) {
        playerMinimize.restoreFromMinimize();
      }
      popOut.togglePopOut();
    } else {
      pip.togglePiP();
    }
  }, [popOut, pip, playerMinimize]);

  const handleMinimize = useCallback(() => {
    // Mutual exclusion with pop-out: if currently popped out, exit
    // pop-out first, then minimize.
    if (IS_NATIVE_PLAYER && popOut.isPopOut) {
      popOut.togglePopOut();
    }
    playerMinimize.minimize();
  }, [popOut, playerMinimize]);

  // Controls visibility (auto-hide on inactivity)
  const { controlsVisible, resetHideTimer, handleMouseMove } =
    usePlayerControlsVisibility(player.isPlaying);

  // Sync-aware play/seek
  const togglePlay = wt.isInSession ? wt.syncTogglePlay : player.togglePlay;
  const seek = wt.isInSession ? wt.syncSeek : player.seek;

  // Click-to-pause / double-click-fullscreen
  const handleVideoClick = useVideoClickHandling(
    togglePlay,
    player.toggleFullscreen,
    resetHideTimer,
  );

  // Playback queue
  const { queue, remainingCount, playNext, playPrev } = useQueue();
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const toggleQueuePanel = useCallback(() => setQueuePanelOpen((v) => !v), []);

  // Auto-populate queue for episodes
  useQueueAutoPopulate(server?.uri, server?.accessToken, ratingKey, player.itemType);

  // Episode navigation — uses queue when available, falls back to Plex API
  const episodeNav = useEpisodeNavigation(
    server,
    ratingKey,
    player.itemType,
  );

  const handleNextEpisode = useCallback(() => {
    const next = playNext();
    if (next) {
      // Mutate ratingKey in place — usePlayer's ratingKey effect re-inits
      // playback. AppLayout + the page underneath stay mounted.
      playerSession.replaceRatingKey(next.ratingKey);
    } else if (episodeNav.handleNextEpisode) {
      episodeNav.handleNextEpisode();
    }
  }, [playNext, episodeNav.handleNextEpisode, playerSession]);

  const handlePrevEpisode = useCallback(() => {
    const prev = playPrev();
    if (prev) {
      playerSession.replaceRatingKey(prev.ratingKey);
    } else if (episodeNav.handlePrevEpisode) {
      episodeNav.handlePrevEpisode();
    }
  }, [playPrev, episodeNav.handlePrevEpisode, playerSession]);

  // "Logical next" — there is a real successor to the currently playing
  // item. Used by:
  //   - PostPlayScreen trigger (only auto-prompt when there's a real next;
  //     standalone movies and final-episodes-with-empty-queue should NOT)
  //   - SkipSegmentButton's "Next Episode" vs "Skip Credits" label
  //   - useSkipSegments synthetic-credits gate (see hasNextEpisode arg)
  //
  // Decision lives in player-postplay-gate.ts so it can be unit-tested
  // directly. See that file's docblock for the rules.
  const hasNextItem = computeHasNextItem({
    itemType: player.itemType,
    ratingKey,
    queue,
    hasPlexNextEpisode: episodeNav.handleNextEpisode != null,
  });

  // Keep a ref to isFullscreen so lifecycle callbacks (useCallback with
  // stable deps) always read the latest value at click time.
  const playerIsFullscreenRef = useRef(player.isFullscreen);
  playerIsFullscreenRef.current = player.isFullscreen;

  // Player lifecycle — exit/prepareNavAway/navAwayPreservingMount.
  const lifecycle = usePlayerLifecycle({
    player,
    popOut,
    playerSession,
    isFullscreenRef: playerIsFullscreenRef,
  });

  // Post-play overlay state + EOF handling + mini-mode handoff.
  const postPlay = usePostPlay({
    player,
    queue,
    ratingKey,
    itemType: player.itemType,
    hasNextItem,
    wtInSession: wt.isInSession,
    isMinimized: playerMinimize.isMinimized,
    autoPlayEnabled: pb.autoPlayEnabled,
    server,
    onAdvanceNext: handleNextEpisode,
    onExit: lifecycle.exit,
    onRestoreFromMinimize: playerMinimize.restoreFromMinimize,
  });

  // Skip intro/credits segments. ratingKey passed as the reset trigger so
  // dismissals + last-active state clear cleanly on every episode change
  // (Player.tsx stays mounted across same-route param navigations).
  // duration + hasNextItem fuel the synthetic "Next Episode" prompt for
  // episodes Plex didn't provide a credits marker for. The estimated
  // credits-window length comes from useShowCreditsLength which medians
  // sibling episodes' credits markers — usually a tighter fit than the
  // hard-coded 90s default. Falls back to 90s when fewer than 3 siblings
  // have markers (i.e. the parent season is too sparse to be useful).
  // hasNextItem is declared earlier — see comment near PostPlayScreen.
  const estimatedCreditsLengthMs = useShowCreditsLength(
    server,
    player.itemType === "episode" ? player.parentRatingKey : undefined,
  );
  const { activeSegment, dismissSegment } = useSkipSegments(
    player.markers,
    player.chapters,
    player.currentTime,
    { intro: pb.skipIntroEnabled, credits: pb.skipCreditsEnabled },
    ratingKey,
    player.duration,
    hasNextItem,
    estimatedCreditsLengthMs,
  );

  const handleSkipSegment = useCallback(() => {
    if (!activeSegment) return;
    // Skip Credits with no continuation = "I'm done watching". Exit the
    // player immediately rather than seeking to a paused-at-EOF black
    // frame. mpv's eof-reached property is unreliable on the seek-past-
    // end path anyway (movie test, 2026-05-03), so we don't even rely on
    // the EOF event firing — go straight to lifecycle.exit.
    if (activeSegment.type === "credits" && !hasNextItem && !wt.isInSession) {
      logger.info("player", "Skip Credits with no continuation — exiting player");
      lifecycle.exit();
      return;
    }
    // Clamp seek target away from exact file end (prexu-7fe.2). When
    // the synthetic credits segment is in play, activeSegment.endTime
    // equals player.duration; seeking to duration parks the playhead
    // at EOF without playback consuming the final frame, so mpv's
    // eof-reached property never flips and postplay autoplay never
    // fires. See clampSkipTarget docs for rationale.
    seek(clampSkipTarget(activeSegment.endTime, player.duration));
    // Force-resume play on Skip Credits (prexu-7fe.2 follow-up): if
    // the user paused mid-credits and then clicked Skip Credits, the
    // clamp alone leaves playback parked at duration-0.5s with no
    // forward motion, so eof-reached never fires and postplay never
    // shows. Skip Credits is an explicit "I'm done with this ep, move
    // on" gesture — resuming play matches that intent and lets the
    // 0.5s tail roll naturally to EOF. Only applies to credits skips;
    // intro skips leave the user's pause state alone (paused at intro
    // is a "let me read this" gesture, not "advance me").
    if (activeSegment.type === "credits" && !player.isPlaying) {
      togglePlay();
    }
  }, [
    activeSegment,
    seek,
    hasNextItem,
    wt.isInSession,
    lifecycle,
    player.duration,
    player.isPlaying,
    togglePlay,
  ]);

  // Next episode detection for Watch Together host
  const nextEp = useNextEpisodeDetection(
    wt.isInSession,
    wt.isHost,
    server,
    ratingKey,
  );

  // Keyboard shortcuts overlay
  const [showShortcuts, setShowShortcuts] = useState(false);
  const toggleShortcuts = useCallback(() => setShowShortcuts((v) => !v), []);

  // Cold-start affordance — first play after install can take ~30s before
  // first frame (libmpv-2.dll page-in, AV first-execution scan, hwdec
  // probing). Spinner alone leaves the user wondering if the app is hung.
  // After 1.5s of isLoading we surface explanatory text. Warm second-plays
  // resolve in <1s so the message never appears in normal use.
  const [showLoadingMsg, setShowLoadingMsg] = useState(false);
  useEffect(() => {
    if (!player.isLoading) {
      setShowLoadingMsg(false);
      return;
    }
    const id = window.setTimeout(() => setShowLoadingMsg(true), 1500);
    return () => window.clearTimeout(id);
  }, [player.isLoading]);

  // Previous-button handler: uses lifecycle.navAwayPreservingMount which
  // drops fullscreen but deliberately does NOT prepareNavAway (Player
  // stays mounted across the ratingKey swap — see the hook's docblock).
  const handlePreviousFromTopBar = useCallback(
    () => lifecycle.navAwayPreservingMount(handlePrevEpisode),
    [lifecycle, handlePrevEpisode],
  );

  // Whether the top-left "Previous" button should appear. True if the queue
  // has an item before the current index, or Plex's adjacent-episode API
  // returned a previous episode. Hidden otherwise (first episode of season,
  // single movie, etc.) — Exit is always available.
  const hasPrevious =
    queue.currentIndex > 0 || episodeNav.handlePrevEpisode != null;

  usePlayerKeyboardShortcuts({
    togglePlay,
    seek,
    currentTime: player.currentTime,
    duration: player.duration,
    volume: player.volume,
    setVolume: player.setVolume,
    toggleFullscreen: player.toggleFullscreen,
    toggleMute: player.toggleMute,
    isFullscreen: player.isFullscreen,
    onBack: lifecycle.exit,
    resetHideTimer,
    chapters: player.chapters,
    volumeBoost: audioEnhancements.volumeBoost,
    normalizationPreset: audioEnhancements.normalizationPreset,
    onAudioEnhancementChange: handleAudioEnhancementChange,
    onNextEpisode: handleNextEpisode,
    onPrevEpisode: handlePrevEpisode,
    togglePiP,
    onToggleShortcuts: toggleShortcuts,
  });

  // Set document title
  useEffect(() => {
    if (player.title) document.title = `${player.title} - Prexu`;
  }, [player.title]);

  // Auth guards — placed after all hooks to respect React rules of hooks
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!serverSelected) return <Navigate to="/servers" replace />;

  // Minimized branch — render just the mini corner region with MiniChrome.
  // All hooks above still run (so playback, WT, timeline reporting, etc.
  // continue) but the full-viewport chrome, PostPlayScreen,
  // KeyboardShortcutsOverlay, etc. are suppressed so the routes underneath
  // remain interactive. The mpv host has already been shrunk by the
  // Rust-side player_enter_minimize call from PlayerContext.minimize();
  // this just makes the React chrome match.
  if (playerMinimize.isMinimized) {
    return (
      <MinimizedPlayer
        player={player}
        playerMinimize={playerMinimize}
        togglePlay={togglePlay}
        seek={seek}
        onExit={lifecycle.exit}
        controlsVisible={controlsVisible}
        resetHideTimer={resetHideTimer}
        handleMouseMove={handleMouseMove}
      />
    );
  }

  return (
    <div
      style={{
        ...styles.container,
        // On the native player path the actual video lives in a sibling
        // Win32 HWND BEHIND this transparent webview. Painting black here
        // would occlude it. HTML5 path keeps black so the <video> letterbox
        // stays cinema-style.
        background: IS_NATIVE_PLAYER ? "transparent" : styles.container.background,
        cursor: controlsVisible ? "default" : "none",
      }}
      onMouseMove={handleMouseMove}
    >
      {/* Video element — only used on the HTML5 path. On native path
          videoRef is never populated, so we hide the element entirely so
          its default black box doesn't occlude the host window. */}
      {IS_NATIVE_PLAYER ? (
        /* Transparent click target for the native path — click to
           play/pause, double-click to fullscreen, same as the HTML5
           <video> element. */
        <div
          style={styles.nativeClickTarget}
          onClick={handleVideoClick}
        />
      ) : (
        <video
          ref={player.videoRef}
          style={styles.video}
          playsInline
          onClick={handleVideoClick}
        />
      )}

      {/* Loading overlay */}
      {player.isLoading && (
        <div style={styles.centerOverlay}>
          <button
            onClick={lifecycle.exit}
            style={styles.loadingBackButton}
            aria-label="Go back"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div style={styles.loadingStack}>
            <div className="loading-spinner" />
            {showLoadingMsg && (
              <div style={styles.loadingMessage}>
                <div style={styles.loadingTitle}>Preparing playback…</div>
                <div style={styles.loadingHint}>
                  First play after install can take a moment.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Buffering overlay */}
      {!player.isLoading && player.isBuffering && (
        <div style={styles.bufferingOverlay}>
          <div className="loading-spinner" />
        </div>
      )}

      {/* Error overlay */}
      {player.playbackError && (
        <ErrorOverlay
          error={player.playbackError}
          onRetry={player.retry}
          onBack={lifecycle.exit}
        />
      )}

      {/* Skip intro/credits button. hasNextEpisode gates the "Next Episode"
          label — must reflect a *logical* next (not just the existence of
          handleNextEpisode, which is always defined). hasNextItem already
          encodes the rule: itemType==="episode" AND (queue has next OR Plex
          episode-nav has next). For movies and last-episodes-with-empty-
          queue this drops the button to "Skip Credits" instead. */}
      {activeSegment && !player.isLoading && !player.playbackError && (
        <SkipSegmentButton
          segment={activeSegment}
          onSkip={handleSkipSegment}
          onDismiss={dismissSegment}
          hasNextEpisode={hasNextItem}
          onNextEpisode={handleNextEpisode}
        />
      )}

      {/* Watch Together participant overlay */}
      {wt.isInSession && (
        <ParticipantOverlay
          participants={wt.participants}
          visible={controlsVisible}
        />
      )}

      {/* Next episode prompt (host only) */}
      {wt.showNextEpisodePrompt && wt.isHost && nextEp && (
        <NextEpisodePrompt
          nextEpisodeTitle={nextEp.title}
          participantCount={wt.participants.length}
          onContinue={() =>
            wt.loadNextEpisode(nextEp.ratingKey, nextEp.title)
          }
          onEndSession={wt.leaveSession}
        />
      )}

      {/* Keyboard shortcuts overlay */}
      <KeyboardShortcutsOverlay
        visible={showShortcuts}
        onClose={toggleShortcuts}
      />

      {/* Player controls overlay */}
      {!player.isLoading && !player.playbackError && (
        <PlayerControls
          player={player}
          onExit={lifecycle.exit}
          onPrevious={hasPrevious ? handlePreviousFromTopBar : undefined}
          visible={controlsVisible}
          chapters={player.chapters}
          onSeek={seek}
          onActivity={resetHideTimer}
          onNextEpisode={handleNextEpisode}
          onPrevEpisode={handlePrevEpisode}
          audioEnhancements={audioEnhancements}
          onAudioEnhancementChange={handleAudioEnhancementChange}
          isPiPActive={pipActive}
          isPiPSupported={pipSupported}
          onTogglePiP={togglePiP}
          isPopOutMode={IS_NATIVE_PLAYER}
          isMinimizeSupported={IS_NATIVE_PLAYER}
          isMinimizeActive={playerMinimize.isMinimized}
          onMinimize={handleMinimize}
          queueCount={remainingCount}
          onToggleQueue={toggleQueuePanel}
          serverUri={server?.uri}
          serverToken={server?.accessToken}
          ratingKey={ratingKey}
          onSubtitleDownloaded={player.retry}
          syncIndicator={
            wt.isInSession ? (
              <SyncIndicator
                syncStatus={wt.syncStatus}
                participantCount={wt.participants.length + 1}
              />
            ) : undefined
          }
        />
      )}

      {/* Post-play screen. Detail-derived fields come from
          derivePostPlayDetailProps so the JSX stays render-shaped.
          upNext is items AFTER the next one (currentIndex+2 onward,
          capped at 4) — the next one itself is already the hero card. */}
      {postPlay.showPostPlay && postPlay.nextQueueItem && server && (
        <PostPlayScreen
          nextItem={postPlay.nextQueueItem}
          onPlayNext={postPlay.onPlayNext}
          onStop={postPlay.onStop}
          posterUrl={(path) => getImageUrl(server.uri, server.accessToken, path, 480, 270)}
          autoPlayEnabled={pb.autoPlayEnabled}
          onAutoPlayChange={(enabled) =>
            updatePreferences({ playback: { autoPlayEnabled: enabled } })
          }
          {...derivePostPlayDetailProps(postPlay.postPlayDetail)}
          upNext={deriveUpNextSlice(queue)}
        />
      )}

      {/* Queue panel */}
      {queuePanelOpen && server && (
        <QueuePanel
          onClose={() => setQueuePanelOpen(false)}
          posterUrl={(path) => getImageUrl(server.uri, server.accessToken, path, 100, 68)}
        />
      )}
    </div>
  );
}

export default Player;
