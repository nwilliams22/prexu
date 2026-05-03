/**
 * Full-page video player route.
 * Sits outside the AppLayout (no header/sidebar).
 */

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "../hooks/useAuth";
import { getImageUrl } from "../services/plex-library";
import { usePlayer, IS_NATIVE_PLAYER } from "../hooks/usePlayer";
import { useWatchTogether } from "../hooks/useWatchTogether";
import { useAudioEnhancements } from "../hooks/useAudioEnhancements";
import { usePreferences } from "../hooks/usePreferences";
import { useSkipSegments } from "../hooks/player/useSkipSegments";
import { usePlayerControlsVisibility } from "../hooks/player/usePlayerControlsVisibility";
import { useVideoClickHandling } from "../hooks/player/useVideoClickHandling";
import { useEpisodeNavigation } from "../hooks/player/useEpisodeNavigation";
import { useQueueAutoPopulate } from "../hooks/player/useQueueAutoPopulate";
import { useQueue } from "../contexts/QueueContext";
import { useNextEpisodeDetection } from "../hooks/player/useNextEpisodeDetection";
import { usePlayerKeyboardShortcuts } from "../hooks/player/usePlayerKeyboardShortcuts";
import { usePictureInPicture } from "../hooks/player/usePictureInPicture";
import PlayerControls from "../components/PlayerControls";
import ParticipantOverlay from "../components/ParticipantOverlay";
import SyncIndicator from "../components/SyncIndicator";
import NextEpisodePrompt from "../components/NextEpisodePrompt";
import ErrorOverlay from "../components/player/ErrorOverlay";
import SkipSegmentButton from "../components/player/SkipSegmentButton";
import QueuePanel from "../components/player/QueuePanel";
import PostPlayScreen from "../components/player/PostPlayScreen";
import KeyboardShortcutsOverlay from "../components/player/KeyboardShortcutsOverlay";
import type { NormalizationPreset } from "../types/preferences";
import { buildSubtitleCss } from "../utils/subtitle-css";
import { logger } from "../services/logger";

function Player() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, serverSelected, server } = useAuth();
  const navigate = useNavigate();

  // Offset override — ?offset=0 means "play from beginning"
  const offsetParam = searchParams.get("offset");
  const offsetOverride = offsetParam != null ? Number(offsetParam) : null;

  const player = usePlayer(ratingKey ?? "", offsetOverride);

  // Watch Together session from URL query params
  const sessionId = searchParams.get("session");
  const isHost = searchParams.get("host") === "true";
  const relayUrl = searchParams.get("relay");
  const wt = useWatchTogether(player, sessionId, isHost, relayUrl);

  const { preferences, updatePreferences } = usePreferences();
  const pb = preferences.playback;

  // Subtitle styling via ::cue CSS (HTML5 path only — native uses libass).
  const subtitleCss = useMemo(() => buildSubtitleCss(pb.subtitleStyle), [pb.subtitleStyle]);
  useEffect(() => {
    if (IS_NATIVE_PLAYER) return;
    const id = "prexu-subtitle-style";
    let styleEl = document.getElementById(id) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = id;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = subtitleCss;
    return () => {
      styleEl?.remove();
    };
  }, [subtitleCss]);

  // Apply libass subtitle style on the native path. Re-fires on every
  // pb.subtitleStyle / pb.subtitleSize change AND once mpv signals ready
  // (player.isLoading false). The ready-trigger covers the initial load
  // case where ensure_init creates mpv after this effect first runs.
  useEffect(() => {
    if (!IS_NATIVE_PLAYER) return;
    if (player.isLoading) return;
    const style = {
      size: pb.subtitleSize,
      fontFamily: pb.subtitleStyle.fontFamily,
      textColor: pb.subtitleStyle.textColor,
      backgroundColor: pb.subtitleStyle.backgroundColor,
      backgroundOpacity: pb.subtitleStyle.backgroundOpacity,
      outlineColor: pb.subtitleStyle.outlineColor,
      outlineWidth: pb.subtitleStyle.outlineWidth,
      shadowEnabled: pb.subtitleStyle.shadowEnabled,
    };
    logger.info("player", "player_apply_sub_style", style);
    invoke("player_apply_sub_style", { style }).catch((err) =>
      logger.error("player", "player_apply_sub_style failed", String(err)),
    );
  }, [player.isLoading, pb.subtitleSize, pb.subtitleStyle]);

  // On the native player path, make body transparent while this route is
  // mounted so the underlying mpv host HWND shows through. MUST be
  // useLayoutEffect rather than useEffect: the Tauri window has
  // `transparent: true`, so any frame where body is transparent AND the
  // DOM is empty (e.g. between Player unmount and Dashboard first paint)
  // shows whatever OS window is behind Prexu (Discord etc.) through the
  // window. useLayoutEffect's cleanup fires synchronously BEFORE the
  // browser paints the post-unmount frame, so the first such paint
  // already has body painted navy (--bg-primary) rather than
  // transparent. Restores to an explicit hex (matches the CSS fallback)
  // instead of the empty-string captured value so we can't accidentally
  // leave body set to an earlier "transparent" if anything else mutated
  // it in between.
  useLayoutEffect(() => {
    if (!IS_NATIVE_PLAYER) return;
    document.body.style.background = "transparent";
    return () => {
      document.body.style.background = "#1a1a2e";
    };
  }, []);

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
      if (changes.volumeBoost !== undefined) {
        audioEnhancements.setVolumeBoost(changes.volumeBoost);
      }
      if (changes.normalizationPreset !== undefined) {
        audioEnhancements.setNormalizationPreset(changes.normalizationPreset);
        if (IS_NATIVE_PLAYER) {
          logger.info("player", "player_set_af_chain", { preset: changes.normalizationPreset });
          invoke("player_set_af_chain", { preset: changes.normalizationPreset }).catch(
            (err) => logger.error("player", "player_set_af_chain failed", String(err)),
          );
        }
      }
      if (changes.audioOffsetMs !== undefined) {
        audioEnhancements.setAudioOffsetMs(changes.audioOffsetMs);
        if (IS_NATIVE_PLAYER) {
          logger.info("player", "player_set_audio_delay_ms", { ms: changes.audioOffsetMs });
          invoke("player_set_audio_delay_ms", { ms: changes.audioOffsetMs }).catch(
            (err) => logger.error("player", "player_set_audio_delay_ms failed", String(err)),
          );
        }
      }
      updatePreferences({ playback: changes });
    },
    [audioEnhancements, updatePreferences],
  );

  // Apply persisted audio enhancements once mpv is ready on the native path.
  // Web Audio path (HTML5) handles initial values via useAudioEnhancements
  // constructor args; native path needs explicit invokes after mpv exists.
  const initialAfAppliedRef = useRef(false);
  useEffect(() => {
    if (!IS_NATIVE_PLAYER) return;
    if (player.isLoading) {
      initialAfAppliedRef.current = false;
      return;
    }
    if (initialAfAppliedRef.current) return;
    initialAfAppliedRef.current = true;
    logger.info("player", "applying initial audio enhancements", {
      preset: pb.normalizationPreset,
      audioOffsetMs: pb.audioOffsetMs,
    });
    invoke("player_set_af_chain", { preset: pb.normalizationPreset }).catch(
      (err) => logger.error("player", "initial player_set_af_chain failed", String(err)),
    );
    invoke("player_set_audio_delay_ms", { ms: pb.audioOffsetMs }).catch(
      (err) => logger.error("player", "initial player_set_audio_delay_ms failed", String(err)),
    );
  }, [player.isLoading, pb.normalizationPreset, pb.audioOffsetMs]);

  // Sync main volume's above-1.0 boost to the audio graph's GainNode
  useEffect(() => {
    audioEnhancements.setMainBoost(Math.max(player.volume, 1));
  }, [player.volume, audioEnhancements]);

  // Picture-in-Picture
  const pip = usePictureInPicture(player.videoRef);

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
      navigate(`/play/${next.ratingKey}`);
    } else if (episodeNav.handleNextEpisode) {
      episodeNav.handleNextEpisode();
    }
  }, [playNext, episodeNav.handleNextEpisode, navigate]);

  const handlePrevEpisode = useCallback(() => {
    const prev = playPrev();
    if (prev) {
      navigate(`/play/${prev.ratingKey}`);
    } else if (episodeNav.handlePrevEpisode) {
      episodeNav.handlePrevEpisode();
    }
  }, [playPrev, episodeNav.handlePrevEpisode, navigate]);

  // Post-play screen — show when playback ends and queue has next item
  const [showPostPlay, setShowPostPlay] = useState(false);
  const postPlayShownRef = useRef(false);

  // videoRef is stable across renders; capture in a ref so handleEnded
  // doesn't need to re-bind when player.videoRef identity changes.
  const playerVideoRefRef = useRef(player.videoRef);
  playerVideoRefRef.current = player.videoRef;

  useEffect(() => {
    const handleEnded = () => {
      if (remainingCount > 0 && !wt.isInSession && !postPlayShownRef.current) {
        postPlayShownRef.current = true;
        // Pause the underlying player synchronously with showing the overlay.
        // Two reasons: (a) on native, mpv with keep-open=always usually stops
        // at EOF but the rare path where it doesn't (or where some other code
        // re-issues loadfile) leaks audio/video under the overlay; (b) on
        // HTML5, browsers may fire `ended` then auto-restart on certain
        // codecs. Idempotent — pausing an already-paused player is a no-op.
        if (IS_NATIVE_PLAYER) {
          invoke("player_pause").catch((err) =>
            logger.warn("player", "PostPlay pause failed", String(err)),
          );
        } else {
          playerVideoRefRef.current.current?.pause();
        }
        setShowPostPlay(true);
      }
    };
    if (IS_NATIVE_PLAYER) {
      // Native path: HTMLVideoElement is null, subscribe to mpv's EndFile via
      // the Tauri bridge instead. Same trigger condition as the HTML5 path.
      let unlisten: (() => void) | null = null;
      let cancelled = false;
      (async () => {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen("player://eof", handleEnded);
        if (cancelled) off();
        else unlisten = off;
      })();
      return () => {
        cancelled = true;
        unlisten?.();
      };
    }
    const video = player.videoRef.current;
    if (!video) return;
    video.addEventListener("ended", handleEnded);
    return () => video.removeEventListener("ended", handleEnded);
  }, [player.videoRef, remainingCount, wt.isInSession]);

  // Reset post-play state when ratingKey changes
  useEffect(() => {
    postPlayShownRef.current = false;
    setShowPostPlay(false);
  }, [ratingKey]);

  const handlePostPlayNext = useCallback(() => {
    setShowPostPlay(false);
    handleNextEpisode();
  }, [handleNextEpisode]);

  // Stop = close overlay AND ensure playback stays halted. Without the
  // explicit pause, anything that resumed playback under the overlay (queued
  // autoplay racing the click, a stray play event, etc.) keeps running after
  // the overlay closes. Resetting postPlayShownRef lets a subsequent EOF
  // re-trigger PostPlay if the user navigates back and lets it end again.
  const handlePostPlayStop = useCallback(() => {
    setShowPostPlay(false);
    postPlayShownRef.current = false;
    if (IS_NATIVE_PLAYER) {
      invoke("player_pause").catch((err) =>
        logger.warn("player", "PostPlay stop pause failed", String(err)),
      );
    } else {
      playerVideoRefRef.current.current?.pause();
    }
  }, []);

  // Get the next queue item for the post-play screen
  const nextQueueItem = useMemo(() => {
    const { items, currentIndex } = queue;
    const nextIdx = currentIndex + 1;
    return nextIdx < items.length ? items[nextIdx] : null;
  }, [queue]);

  // Skip intro/credits segments
  const { activeSegment, dismissSegment } = useSkipSegments(
    player.markers,
    player.chapters,
    player.currentTime,
    { intro: pb.skipIntroEnabled, credits: pb.skipCreditsEnabled },
  );

  const handleSkipSegment = useCallback(() => {
    if (activeSegment) {
      seek(activeSegment.endTime);
    }
  }, [activeSegment, seek]);

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

  // Keep a ref to isFullscreen so handleExit (useCallback with stable
  // deps) always reads the latest value at click time.
  const playerIsFullscreenRef = useRef(player.isFullscreen);
  playerIsFullscreenRef.current = player.isFullscreen;

  // Pre-navigation cleanup shared by Exit and Previous: paint body opaque
  // BEFORE navigate. The useLayoutEffect cleanup further up SHOULD run sync
  // before paint, but in practice WebView2 with transparent:true can still
  // composite one frame where body=transparent during the Player→next-route
  // swap, leaking whatever OS window is behind Prexu (Discord). Doing it
  // here runs while Player is still mounted — the Player container is
  // fixed+transparent so mpv is still visible to the user, but the next
  // post-unmount paint has body already navy. Belt-and-suspenders: cleanup
  // still runs, idempotent second write.
  const prepareNavAway = useCallback(async () => {
    if (IS_NATIVE_PLAYER) {
      document.body.style.background = "#1a1a2e";
      if (playerIsFullscreenRef.current) {
        try {
          await invoke("player_set_fullscreen", { fullscreen: false });
        } catch {
          // Swallow — cleanup path's fullscreen-exit safety net catches up.
        }
      }
    }
  }, []);

  // Exit = leave the player route entirely. Used by the X button in the
  // player toolbar AND by ESC keypress. Restores the route the user was on
  // before they pressed Play (typically an item detail page or library) by
  // reading the pointer App.tsx writes to sessionStorage on every non-/play
  // location change. navigate(-1) was wrong because auto-advancing through
  // multiple episodes piled /play/* entries onto history, trapping the user.
  const handleExit = useCallback(async () => {
    await prepareNavAway();
    const target = sessionStorage.getItem("prexu.lastNonPlayerRoute") || "/";
    navigate(target);
  }, [prepareNavAway, navigate]);

  // Previous = go to the prior episode/queue item. Mirrors handleNextEpisode
  // shape: queue first, then Plex episode-nav fallback. Same nav-cleanup as
  // exit so the body-paint flicker doesn't happen on inter-episode jumps.
  const handlePreviousFromTopBar = useCallback(async () => {
    await prepareNavAway();
    handlePrevEpisode();
  }, [prepareNavAway, handlePrevEpisode]);

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
    onBack: handleExit,
    resetHideTimer,
    chapters: player.chapters,
    volumeBoost: audioEnhancements.volumeBoost,
    normalizationPreset: audioEnhancements.normalizationPreset,
    onAudioEnhancementChange: handleAudioEnhancementChange,
    onNextEpisode: handleNextEpisode,
    onPrevEpisode: handlePrevEpisode,
    togglePiP: pip.togglePiP,
    onToggleShortcuts: toggleShortcuts,
  });

  // Set document title
  useEffect(() => {
    if (player.title) document.title = `${player.title} - Prexu`;
  }, [player.title]);

  // Auth guards — placed after all hooks to respect React rules of hooks
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!serverSelected) return <Navigate to="/servers" replace />;

  return (
    <div
      style={{
        ...styles.container,
        // On the native player path the actual video lives in a sibling
        // Win32 HWND BEHIND this transparent webview. Painting black here
        // would occlude it. HTML5 path keeps black so the <video> letterbox
        // stays cinema-style.
        background: IS_NATIVE_PLAYER ? "transparent" : styles.container.background,
        // On native path, never hide the cursor — WebView2 passes mouse
        // events through transparent areas, so cursor: none + transparent
        // webview = permanently lost cursor (onMouseMove can't fire to
        // bring controls back). HTML5 path hides cursor normally.
        cursor: controlsVisible || IS_NATIVE_PLAYER ? "default" : "none",
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
            onClick={handleExit}
            style={styles.loadingBackButton}
            aria-label="Go back"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="loading-spinner" />
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
          onBack={handleExit}
        />
      )}

      {/* Skip intro/credits button */}
      {activeSegment && !player.isLoading && !player.playbackError && (
        <SkipSegmentButton
          segment={activeSegment}
          onSkip={handleSkipSegment}
          onDismiss={dismissSegment}
          hasNextEpisode={!!handleNextEpisode}
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
          onExit={handleExit}
          onPrevious={hasPrevious ? handlePreviousFromTopBar : undefined}
          visible={controlsVisible}
          chapters={player.chapters}
          onSeek={seek}
          onActivity={resetHideTimer}
          onNextEpisode={handleNextEpisode}
          onPrevEpisode={handlePrevEpisode}
          audioEnhancements={audioEnhancements}
          onAudioEnhancementChange={handleAudioEnhancementChange}
          isPiPActive={pip.isPiPActive}
          isPiPSupported={pip.isPiPSupported}
          onTogglePiP={pip.togglePiP}
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

      {/* Post-play screen */}
      {showPostPlay && nextQueueItem && server && (
        <PostPlayScreen
          nextItem={nextQueueItem}
          onPlayNext={handlePostPlayNext}
          onStop={handlePostPlayStop}
          posterUrl={(path) => getImageUrl(server.uri, server.accessToken, path, 320, 220)}
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

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    inset: 0,
    background: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    outline: "none",
  },
  nativeClickTarget: {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    // Minimum opacity for WebView2 hit-testing. Fully transparent areas
    // pass mouse events to the Win32 window behind — this thin overlay
    // is barely visible but ensures onMouseMove reaches React so controls
    // auto-show and click-to-pause work.
    background: "rgba(0,0,0,0.05)",
  },
  centerOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.3)",
    zIndex: 5,
  },
  loadingBackButton: {
    position: "absolute",
    top: "1.5rem",
    left: "1.5rem",
    background: "rgba(0,0,0,0.5)",
    border: "none",
    borderRadius: "50%",
    width: "44px",
    height: "44px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    cursor: "pointer",
    zIndex: 10,
  },
  bufferingOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.3)",
    zIndex: 5,
    pointerEvents: "none",
  },
};

export default Player;
