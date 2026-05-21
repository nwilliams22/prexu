/**
 * Full-page video player overlay.
 *
 * Mounted by PlayerOverlay (App.tsx) when PlayerContext has an active
 * session — never rendered as a route directly. Position-fixed full
 * viewport, so it visually replaces whatever's underneath while open
 * and instantly reveals it on stop.
 */

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { Navigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "../hooks/useAuth";
import { usePlayerSession, type PlayerWatchTogether } from "../contexts/PlayerContext";
import { getImageUrl, getItemMetadata } from "../services/plex-library";
import type { PlexEpisode, PlexMediaItem } from "../types/library";
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
import { usePopOutPlayer } from "../hooks/player/usePopOutPlayer";
import PlayerControls from "../components/PlayerControls";
import ParticipantOverlay from "../components/ParticipantOverlay";
import SyncIndicator from "../components/SyncIndicator";
import NextEpisodePrompt from "../components/NextEpisodePrompt";
import ErrorOverlay from "../components/player/ErrorOverlay";
import SkipSegmentButton from "../components/player/SkipSegmentButton";
import QueuePanel from "../components/player/QueuePanel";
import PostPlayScreen from "../components/player/PostPlayScreen";
import KeyboardShortcutsOverlay from "../components/player/KeyboardShortcutsOverlay";
import MiniChrome from "../components/player/MiniChrome";
import type { NormalizationPreset } from "../types/preferences";
import { buildSubtitleCss } from "../utils/subtitle-css";
import { logger } from "../services/logger";
import { hasNextItem as computeHasNextItem } from "./player-postplay-gate";
import { miniRectToContainerStyle } from "../utils/mini-rect";

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
  //
  // prexu-s0f: body MUST stay transparent during minimize mode too.
  // The mini region needs the WebView pixels to be truly transparent
  // (alpha=0) so the OS composites the Win32 mpv host window behind
  // through. The previous prexu-4k5 attempt to flip body to opaque
  // navy in minimize mode covered the mpv host. With AppLayout now
  // painted opaquely (prexu-ya6) but masked to have a 360x200 hole
  // in the bottom-right (this fix's mate over in AppLayout.tsx), the
  // hole reveals body (transparent) → WebView pixels transparent in
  // that region → Win32 mpv host visible through. Everywhere else,
  // AppLayout's opaque content covers body.
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

  // Picture-in-Picture vs pop-out. On the native (mpv) path there's no
  // <video> element so the browser PiP API silently fails — we route the
  // PiP slot to our Win32-native floating pop-out window on Tauri, and
  // to the standard browser PiP everywhere else. The Rust side owns the
  // pop-out geometry (corner + size) and reads it from the persisted
  // store; user-driven resizes round-trip across sessions.
  //
  // 7il.4: the native path now has a SECOND button for in-window minimize
  // (the small bottom-right corner mode). The two buttons are mutually
  // exclusive — `handleMinimize` exits pop-out first when needed, and
  // `togglePiP` exits minimize first when needed.
  const pip = usePictureInPicture(player.videoRef);
  const popOut = usePopOutPlayer();
  const pipActive = IS_NATIVE_PLAYER ? popOut.isPopOut : pip.isPiPActive;
  const pipSupported = IS_NATIVE_PLAYER
    ? popOut.isPopOutSupported
    : pip.isPiPSupported;
  const togglePiP = useCallback(() => {
    if (IS_NATIVE_PLAYER) {
      // Mutual exclusion with minimize: if currently minimized, restore
      // to full first, then pop out (7il.4).
      if (playerSession.isMinimized) {
        playerSession.restoreFromMinimize();
      }
      popOut.togglePopOut();
    } else {
      pip.togglePiP();
    }
  }, [popOut, pip, playerSession]);

  const handleMinimize = useCallback(() => {
    // Mutual exclusion with pop-out: if currently popped out, exit
    // pop-out first, then minimize (7il.4).
    if (IS_NATIVE_PLAYER && popOut.isPopOut) {
      popOut.togglePopOut();
    }
    playerSession.minimize();
  }, [popOut, playerSession]);

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
  // directly. See that file's docblock for the rules. Movies inside a
  // user-built playlist/collection do trigger PostPlay (prexu-9yn);
  // standalone movies still auto-exit at EOF (prexu-3z9 unchanged).
  const hasNextItem = computeHasNextItem({
    itemType: player.itemType,
    ratingKey,
    queue,
    hasPlexNextEpisode: episodeNav.handleNextEpisode != null,
  });

  // Post-play screen — show when playback ends and there's a logical next
  const [showPostPlay, setShowPostPlay] = useState(false);
  const postPlayShownRef = useRef(false);
  // Enriched metadata for the next item — fetched when PostPlay is about to
  // show so we can render synopsis, air date, watched chip, and credits in
  // the upper-half overlay. Null until the fetch lands; the overlay still
  // renders immediately with the lightweight QueueItem fields and fades the
  // extras in when this populates. Cleared on ratingKey change.
  const [postPlayDetail, setPostPlayDetail] = useState<
    PlexEpisode | PlexMediaItem | null
  >(null);

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
      // hasNextItem encodes "real successor exists":
      //  - episode with queue/episode-nav next, OR
      //  - any type playing from a user-built queue with another item next.
      // A standalone movie should NOT pop PostPlay against a stale auto-
      // populated episode queue, which is why we distinguish queue.source
      // (see prexu-9yn).
      logger.debug("postplay", "EOF reached", {
        itemType: player.itemType,
        hasNextItem,
        queueSource: queue.source,
        queueCurrentIndex: queue.currentIndex,
        queueLength: queue.items.length,
        wtInSession: wt.isInSession,
      });
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
    setPostPlayDetail(null);
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

  // Fetch enriched metadata for the next item when PostPlay is about to show
  // so synopsis/air date/cast/director/watched-chip can populate the upper-
  // half overlay. The overlay still renders immediately from the lightweight
  // QueueItem; this just lights up the richer fields when they arrive.
  const nextRatingKeyForFetch =
    showPostPlay && nextQueueItem ? nextQueueItem.ratingKey : null;
  useEffect(() => {
    if (!nextRatingKeyForFetch || !server) return;
    let cancelled = false;
    getItemMetadata<PlexMediaItem>(
      server.uri,
      server.accessToken,
      nextRatingKeyForFetch,
    )
      .then((detail) => {
        if (cancelled) return;
        setPostPlayDetail(detail);
      })
      .catch((err) => {
        // Best-effort — PostPlay still works without the enriched fields.
        logger.warn("postplay", "next-item metadata fetch failed", String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [nextRatingKeyForFetch, server]);

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

  // Pre-exit cleanup: paint body opaque + drop fullscreen before tearing
  // mpv down. The useLayoutEffect cleanup further up SHOULD run sync
  // before paint, but in practice WebView2 with transparent:true can
  // still composite one frame where body=transparent during the
  // Player→underneath swap, leaking whatever OS window is behind Prexu
  // (Discord). Doing it here runs while Player is still mounted — the
  // Player container is fixed+transparent so mpv is still visible to
  // the user, but the next post-unmount paint has body already navy.
  // Belt-and-suspenders: cleanup still runs, idempotent second write.
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

  // Exit = close the player overlay. The page underneath stays mounted
  // (AppLayout never unmounted), so the user is back where they launched
  // from instantly — no route navigation, no remount, no spinner.
  // Audio is silenced synchronously by the awaited player_unload (the
  // pump-join + final mpv terminate happen in the background — see
  // src-tauri/src/player/mod.rs destroy()).
  const handleExit = useCallback(async () => {
    logger.info("player", "handleExit start");
    // If we're in pop-out mode, exit it FIRST so the main window is
    // restored to its pre-pop-out outer geometry and always-on-top is
    // cleared before we unload the player. Without this the app stays at
    // the 480x270 pop-out size after the player closes (prexu-ltu / mw5
    // follow-up).
    if (IS_NATIVE_PLAYER && popOut.isPopOut) {
      try {
        popOut.togglePopOut();
      } catch (err) {
        logger.warn("player", "handleExit exit-popout failed", String(err));
      }
    }
    await prepareNavAway();
    if (IS_NATIVE_PLAYER) {
      try {
        await invoke("player_unload");
      } catch (err) {
        logger.warn("player", "handleExit player_unload failed", String(err));
      }
    }
    playerSession.stop();
  }, [prepareNavAway, playerSession, popOut]);
  // Keep the ref pointed at the latest handleExit so handlePostPlayStop,
  // handleSkipSegment, and the EOF effect (all declared earlier) always
  // invoke the current closure.
  handleExitRef.current = handleExit;

  // Previous = go to the prior episode/queue item. Mirrors handleNextEpisode
  // shape: queue first, then Plex episode-nav fallback. We deliberately do
  // NOT paint body opaque here even though prepareNavAway would: Player
  // stays mounted across ratingKey swaps (the new context.replaceRatingKey
  // mutates the session in place so the overlay doesn't unmount), so the
  // useLayoutEffect that paints body transparent doesn't re-run. Painting
  // it opaque on the way out without the cleanup ever firing leaves the
  // user staring at a navy background while mpv plays invisibly underneath.
  // Fullscreen exit is still safe — that's a one-shot Win32 call, not a paint.
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

  // Minimized branch (prexu-7il.3/.5/.7) — render just the mini corner
  // region with MiniChrome. All hooks above still run (so playback, WT,
  // timeline reporting, etc. continue) but the full-viewport chrome,
  // PostPlayScreen, KeyboardShortcutsOverlay, etc. are suppressed so
  // the routes underneath remain interactive. The mpv host has already
  // been shrunk by the Rust-side player_enter_minimize call from
  // PlayerContext.minimize(); this just makes the React chrome match.
  //
  // Position + size come from PlayerContext.miniRect so the cut-out
  // (AppLayout mask) and this overlay stay in lockstep with the user's
  // chosen corner + size. miniRectToContainerStyle picks the right
  // top/bottom/left/right pair for the anchor corner.
  if (playerSession.isMinimized) {
    const miniRect = playerSession.miniRect;
    return (
      <div
        style={{
          ...styles.miniContainerBase,
          ...miniRectToContainerStyle(miniRect),
        }}
      >
        <MiniChrome
          isPlaying={player.isPlaying}
          onTogglePlay={togglePlay}
          onRestore={playerSession.restoreFromMinimize}
          onClose={handleExit}
          title={player.title ?? undefined}
          visible={controlsVisible}
          onActivity={resetHideTimer}
          onMouseMove={handleMouseMove}
          miniRect={miniRect}
          onUpdateMiniRect={playerSession.updateMiniRect}
        />
      </div>
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
          isPiPActive={pipActive}
          isPiPSupported={pipSupported}
          onTogglePiP={togglePiP}
          isPopOutMode={IS_NATIVE_PLAYER}
          isMinimizeSupported={IS_NATIVE_PLAYER}
          isMinimizeActive={playerSession.isMinimized}
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

      {/* Post-play screen */}
      {showPostPlay && nextQueueItem && server && (
        <PostPlayScreen
          nextItem={nextQueueItem}
          onPlayNext={handlePostPlayNext}
          onStop={handlePostPlayStop}
          posterUrl={(path) => getImageUrl(server.uri, server.accessToken, path, 480, 270)}
          autoPlayEnabled={pb.autoPlayEnabled}
          onAutoPlayChange={(enabled) =>
            updatePreferences({ playback: { autoPlayEnabled: enabled } })
          }
          synopsis={postPlayDetail?.summary || undefined}
          airDate={
            postPlayDetail &&
            "originallyAvailableAt" in postPlayDetail &&
            postPlayDetail.originallyAvailableAt
              ? new Date(postPlayDetail.originallyAvailableAt).toLocaleDateString(
                  undefined,
                  { year: "numeric", month: "short", day: "numeric" },
                )
              : undefined
          }
          watched={
            postPlayDetail
              ? ((postPlayDetail as { viewCount?: number }).viewCount ?? 0) > 0
              : undefined
          }
          directors={
            postPlayDetail && "Director" in postPlayDetail
              ? postPlayDetail.Director?.map((d) => d.tag).slice(0, 3)
              : undefined
          }
          cast={
            postPlayDetail && "Role" in postPlayDetail
              ? postPlayDetail.Role?.map((r) => r.tag).slice(0, 3)
              : undefined
          }
          upNext={(() => {
            // Items AFTER the next one (currentIndex + 2 onward, capped at
            // 4) — the next one itself is already the hero card.
            const start = queue.currentIndex + 2;
            const slice = queue.items.slice(start, start + 4);
            return slice.length > 0 ? slice : undefined;
          })()}
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
  // Corner region used when PlayerContext.isMinimized is true
  // (prexu-7il.3/.5/.7). Size + anchor offsets are spread on top via
  // `miniRectToContainerStyle(miniRect)` so the wrapper aligns with the
  // mpv host window pixel-for-pixel as the user resizes and drags it
  // between corners. Background stays transparent so the mpv host sibling
  // Win32 window shows through.
  miniContainerBase: {
    position: "fixed",
    background: "transparent",
    // overflow: visible lets the resize handle (which sits on the corner
    // opposite the anchor, at an offset of -6,-6) hang slightly outside
    // the mini bounds — it remains hit-testable. The container itself is
    // still bounded by width/height for layout purposes.
    overflow: "visible",
    // High z-index so chrome floats above any underlying routes that may
    // have their own elevated layers (sidebars, modals, etc.).
    zIndex: 1000,
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
