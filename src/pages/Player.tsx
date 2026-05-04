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
import { useShowCreditsLength } from "../hooks/player/useShowCreditsLength";
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

  // "Logical next" — current item is an episode AND a successor exists via
  // queue or Plex episode-nav. Used by:
  //   - PostPlayScreen trigger (only auto-prompt for episodes with a real
  //     next; movies and final-episodes-with-empty-queue should NOT)
  //   - SkipSegmentButton's "Next Episode" vs "Skip Credits" label
  //   - useSkipSegments synthetic-credits gate (see hasNextEpisode arg)
  // Movies always evaluate false here, so a stale TV item in the persisted
  // queue can't hijack movie playback at the credits point.
  const hasNextItem =
    player.itemType === "episode" &&
    (queue.currentIndex + 1 < queue.items.length ||
      episodeNav.handleNextEpisode != null);

  // Post-play screen — show when playback ends and there's a logical next
  const [showPostPlay, setShowPostPlay] = useState(false);
  const postPlayShownRef = useRef(false);

  // Forwarded handleExit — declared further down. handleEnded (inside the
  // EOF effect) and handleSkipSegment both call this on the no-continuation
  // path so we exit the player immediately rather than stranding the user
  // on a paused-at-EOF black frame.
  const handleExitRef = useRef<() => void>(() => {});

  // videoRef is stable across renders; capture in a ref so handleEnded
  // doesn't need to re-bind when player.videoRef identity changes.
  const playerVideoRefRef = useRef(player.videoRef);
  playerVideoRefRef.current = player.videoRef;

  useEffect(() => {
    const handleEnded = () => {
      // hasNextItem (itemType==="episode" AND queue/episode-nav has next)
      // is the correct gate: a movie ending should NOT pop PostPlay even if
      // the queue has stale items. Same root issue as SkipSegmentButton's
      // "Next Episode" gate — both feed off the same notion of "logical next".
      if (hasNextItem && !wt.isInSession && !postPlayShownRef.current) {
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
        return;
      }
      // No continuation path: not in WT (host drives flow there) and either
      // a movie or a final episode. Exit the player immediately — the
      // user has no next item and nothing to interact with on a paused-
      // at-EOF black frame.
      if (!hasNextItem && !wt.isInSession) {
        logger.info("player", "EOF with no continuation — exiting player");
        handleExitRef.current();
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
  }, [player.videoRef, hasNextItem, wt.isInSession]);

  // Reset post-play state when ratingKey changes
  useEffect(() => {
    postPlayShownRef.current = false;
    setShowPostPlay(false);
  }, [ratingKey]);

  const handlePostPlayNext = useCallback(() => {
    setShowPostPlay(false);
    handleNextEpisode();
  }, [handleNextEpisode]);

  // Stop on PostPlay = the user's intent is "I'm done watching" — leave the
  // player route entirely (same as the bottom-bar Stop button + ESC). Just
  // hiding the overlay would leave the user staring at a paused black frame
  // since the underlying mpv is at EOF; that's what looked like a "page
  // reload" to the user (the URL didn't change, they just went from overlay
  // to player chrome). Reset postPlayShownRef so a fresh navigation back
  // into this episode can re-trigger PostPlay later. handleExit is declared
  // further down (after a couple of other callbacks it depends on); going
  // through handleExitRef (declared above) avoids the forward-reference and
  // keeps the useCallback dep list clean.
  const handlePostPlayStop = useCallback(() => {
    setShowPostPlay(false);
    postPlayShownRef.current = false;
    handleExitRef.current();
  }, []);

  // Get the next queue item for the post-play screen
  const nextQueueItem = useMemo(() => {
    const { items, currentIndex } = queue;
    const nextIdx = currentIndex + 1;
    return nextIdx < items.length ? items[nextIdx] : null;
  }, [queue]);

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
    // the EOF event firing — go straight to handleExit.
    if (activeSegment.type === "credits" && !hasNextItem && !wt.isInSession) {
      logger.info("player", "Skip Credits with no continuation — exiting player");
      handleExitRef.current();
      return;
    }
    seek(activeSegment.endTime);
  }, [activeSegment, seek, hasNextItem, wt.isInSession]);

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
    logger.info("player", "handleExit start");
    await prepareNavAway();
    // Tear down mpv synchronously BEFORE navigating away. The useEffect
    // cleanup that runs post-unmount fires player_unload fire-and-forget,
    // which races mpv terminate against React's next paint and leaks
    // ~2-3s of buffered audio while the dashboard is already showing.
    // Awaiting here pushes the route change until destroy() returns; the
    // cleanup then no-ops via "destroy: nothing to destroy".
    if (IS_NATIVE_PLAYER) {
      try {
        await invoke("player_unload");
      } catch (err) {
        logger.warn("player", "handleExit player_unload failed", String(err));
      }
    }
    const target = sessionStorage.getItem("prexu.lastNonPlayerRoute") || "/";
    navigate(target);
  }, [prepareNavAway, navigate]);
  // Keep the ref pointed at the latest handleExit so handlePostPlayStop,
  // handleSkipSegment, and the EOF effect (all declared earlier) always
  // invoke the current closure.
  handleExitRef.current = handleExit;

  // Previous = go to the prior episode/queue item. Mirrors handleNextEpisode
  // shape: queue first, then Plex episode-nav fallback. We deliberately do
  // NOT paint body opaque here even though prepareNavAway would: Player
  // stays mounted across same-route param changes (RR v7 behaviour for
  // /play/:ratingKey → /play/:otherKey), so the useLayoutEffect that
  // paints body transparent doesn't re-run. Painting it opaque on the way
  // out without the cleanup ever firing leaves the user staring at a navy
  // background while mpv plays invisibly underneath. Fullscreen exit is
  // still safe to do here — that's a one-shot Win32 call, not a paint.
  const handlePreviousFromTopBar = useCallback(async () => {
    if (IS_NATIVE_PLAYER && playerIsFullscreenRef.current) {
      try {
        await invoke("player_set_fullscreen", { fullscreen: false });
      } catch {
        // Cleanup path catches up.
      }
    }
    handlePrevEpisode();
  }, [handlePrevEpisode]);

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
            onClick={handleExit}
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
          onBack={handleExit}
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
          autoPlayEnabled={pb.autoPlayEnabled}
          onAutoPlayChange={(enabled) =>
            updatePreferences({ playback: { autoPlayEnabled: enabled } })
          }
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
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1.25rem",
  },
  loadingMessage: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.35rem",
    color: "rgba(255,255,255,0.85)",
    animation: "fadeIn 0.4s ease-out",
  },
  loadingTitle: {
    fontSize: "1rem",
    fontWeight: 600,
  },
  loadingHint: {
    fontSize: "0.85rem",
    color: "rgba(255,255,255,0.55)",
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
