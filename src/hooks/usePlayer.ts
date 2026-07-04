/**
 * Core playback hook. Dispatches to one of two backends per Player mount:
 * - Native (Windows or Linux, Tauri): `useNativePlayer` — libmpv via
 *   player://* events
 * - everywhere else / when the user opts out: HTML5 `<video>` + hls.js
 *   (the original implementation below, `useHtml5Player`)
 *
 * Both backends return the same `UsePlayerResult` so PlayerControls,
 * watch-together hooks, and the post-play screen don't care which is
 * active — they can read `player.engine` if they need to know.
 *
 * The dispatch decision is resolved ONCE per Player mount via a lazy
 * useState initializer (see engineResolution.ts for the full contract).
 * React requires the SAME hook to be called across every render of a
 * given component instance — the rules-of-hooks invariant holds because
 * `engine` never changes after the first render of a given `usePlayer`
 * call site. A runtime fallback (native failing mid-session) works by
 * forcing PlayerOverlay to fully remount `<Player>`, not by flipping this
 * value in place.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "./useAuth";
import { usePreferences } from "./usePreferences";
import { useHlsLoader } from "./player/useHlsLoader";
import { useTimelineReporting } from "./player/useTimelineReporting";
import { useStreamSelection } from "./player/useStreamSelection";
import { useNativePlayer } from "./player/useNativePlayer";
import {
  IS_NATIVE_PLAYER_PLATFORM,
  SUPPORTS_PLAYER_MINIMIZE,
  SUPPORTS_PLAYER_POPOUT,
  isSessionFallbackActive,
  resolveEngineChoice,
  type ResolvedEngine,
} from "./player/engineResolution";
import { addPendingWatchSync } from "../services/storage";
import {
  prepareSource,
  applyPreparedMetadata,
  refreshDownloadedSubtitles,
  buildHlsConfig,
  reportTimeline,
  getSavedVolume,
  saveVolume,
  getSavedMuted,
  saveMuted,
} from "../services/plex-playback";
import type {
  PlexChapter,
  PlexMarker,
  PlexStream,
} from "../types/library";
import type {
  NormalizationPreset,
  SubtitleStylePreferences,
} from "../types/preferences";
import { buildSubtitleCss } from "../utils/subtitle-css";
import { logger, redactUrl } from "../services/logger";

// Re-exported so existing call sites that import platform/engine constants
// from "../hooks/usePlayer" (the historical home of IS_NATIVE_PLAYER) keep
// working without an extra import path. See engineResolution.ts for docs.
export { IS_NATIVE_PLAYER_PLATFORM, SUPPORTS_PLAYER_MINIMIZE, SUPPORTS_PLAYER_POPOUT };
export type { ResolvedEngine };

export interface UsePlayerResult {
  // Refs
  videoRef: React.RefObject<HTMLVideoElement | null>;

  // Metadata
  title: string;
  subtitle: string;

  // Playback state
  isLoading: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  playbackError: string | null;

  // Media info
  chapters: PlexChapter[];
  markers: PlexMarker[];
  itemType: string;
  /** For episodes: the season's ratingKey, used by useShowCreditsLength to
   *  fetch sibling episodes for the credits-length median estimate. Empty
   *  string for movies / non-episode media. */
  parentRatingKey: string;

  // Stream info
  audioTracks: PlexStream[];
  subtitleTracks: PlexStream[];
  selectedAudioId: number | null;
  selectedSubtitleId: number | null;

  // Actions
  togglePlay: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  selectAudioTrack: (streamId: number) => void;
  selectSubtitleTrack: (streamId: number | null) => void;
  retry: () => void;
  /** After an on-demand subtitle download: poll metadata for the new stream,
   *  persist it as the part default on the server (Plex deletes unselected
   *  on-demand downloads), and start showing it without restarting playback.
   *  Native: mpv sub-add into the running instance. HTML5: HLS rebuild at the
   *  current position via selectSubtitleTrack. */
  refreshSubtitlesAfterDownload: () => Promise<void>;

  // ── Backend dispatch methods ──────────────────────────────────────────────
  // These let consumers drive platform-specific player IPC without
  // branching on IS_NATIVE_PLAYER. Each backend implements them per its
  // own semantics; the consumer just calls the method on `player`.

  /** Pause playback. No-op if already paused. Idempotent. */
  pause: () => void;
  /** Tear down the player. Native: invoke("player_unload"). HTML5: no-op
   *  (unmount cleanup handles it). Caller awaits before navigating away. */
  unload: () => Promise<void>;
  /** Set fullscreen explicitly. Native: invoke("player_set_fullscreen").
   *  HTML5: document.requestFullscreen / exitFullscreen on documentElement.
   *  Returns when the OS transition has been requested (not necessarily
   *  settled). */
  setFullscreen: (fullscreen: boolean) => Promise<void>;
  /** Subscribe to end-of-file. Native: listen to player://eof. HTML5:
   *  video.addEventListener("ended"). Returns an unsubscribe function. */
  subscribeToEof: (handler: () => void) => () => void;
  /** Apply a libass/CSS subtitle style. Native: caches latest and invokes
   *  player_apply_sub_style once mpv is ready (re-applies on every change).
   *  HTML5: maintains a <style id="prexu-subtitle-style"> tag with ::cue
   *  CSS derived from the prefs via buildSubtitleCss. */
  applySubtitleStyle: (args: { size: number; style: SubtitleStylePreferences }) => void;
  /** Apply audio enhancement changes that require backend-specific IPC.
   *  Native: invoke("player_set_af_chain") and/or "player_set_audio_delay_ms".
   *  HTML5: no-op (the Web Audio graph from useAudioEnhancements is the
   *  authoritative path on HTML5). The caller should still update the
   *  React-side audioEnhancements state for the Web Audio path; this
   *  method only handles the backend-side IPC. */
  applyAudioEnhancement: (changes: {
    normalizationPreset?: NormalizationPreset;
    audioOffsetMs?: number;
  }) => void;

  /**
   * Which backend this Player mount is actually using — "native" (mpv) or
   * "html5". Fixed for the lifetime of the mount (see engineResolution.ts).
   * Consumers that used to branch on the old module-level IS_NATIVE_PLAYER
   * constant should read this instead — it reflects the resolved choice
   * for THIS session (preference + platform + fallback), not just platform
   * capability. Window-management affordances should still gate on
   * SUPPORTS_PLAYER_MINIMIZE / SUPPORTS_PLAYER_POPOUT, not this field —
   * native on Linux has minimize but not pop-out IPC yet (prexu-axj4.10).
   */
  engine: ResolvedEngine;

  /**
   * Identity-stable slice of this result: everything except the 4 Hz
   * time-pos values (`currentTime` / `buffered`). Both backends memoize
   * this object over stable callbacks + rarely-changing state only, so
   * its identity survives time-pos ticks. Chrome components (buttons,
   * menus, transport) and effects should consume this slice — or
   * individual fields/callbacks — instead of the whole result, which
   * gets a new identity on every tick. Components that genuinely
   * display time (seek bar, time labels) keep reading `currentTime` /
   * `buffered` from the full result.
   */
  chrome: PlayerChrome;
}

/**
 * The tick-stable portion of `UsePlayerResult` — see `UsePlayerResult.chrome`.
 */
export type PlayerChrome = Omit<
  UsePlayerResult,
  "currentTime" | "buffered" | "chrome"
>;

export function usePlayer(ratingKey: string, offsetOverride?: number | null): UsePlayerResult {
  const { preferences } = usePreferences();

  // Resolved ONCE via a lazy useState initializer — this is what makes the
  // ternary below safe under rules-of-hooks. `engine` never changes across
  // re-renders of this component instance, even if preferences or the
  // session-fallback flag change later; a runtime fallback instead forces
  // PlayerOverlay to remount <Player> with a fresh key, which re-runs this
  // initializer from scratch and picks up the (by then true) fallback flag.
  const [engine] = useState<ResolvedEngine>(() =>
    resolveEngineChoice({
      platformCapable: IS_NATIVE_PLAYER_PLATFORM,
      playerEngine: preferences.playback.playerEngine,
      sessionFallback: isSessionFallbackActive(),
    }),
  );

  return engine === "native"
    ? useNativePlayer(ratingKey, offsetOverride)
    : useHtml5Player(ratingKey, offsetOverride);
}

function useHtml5Player(ratingKey: string, offsetOverride?: number | null): UsePlayerResult {
  const { server } = useAuth();
  const { preferences } = usePreferences();
  const prefsRef = useRef(preferences);
  prefsRef.current = preferences;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Sub-hooks
  const hlsLoader = useHlsLoader();
  const timeline = useTimelineReporting(server);

  // Metadata
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");

  // State
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolumeState] = useState(getSavedVolume);
  // Persisted like volume (prexu-jphh) — parity with useNativePlayer, and
  // applied to the <video> element at init (video.muted = isMutedRef.current).
  const [isMuted, setIsMuted] = useState(getSavedMuted);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // Media info
  const [chapters, setChapters] = useState<PlexChapter[]>([]);
  const [markers, setMarkers] = useState<PlexMarker[]>([]);
  const [itemType, setItemType] = useState("");
  const [parentRatingKey, setParentRatingKey] = useState("");

  // Stream selection sub-hook
  const streams = useStreamSelection(
    server,
    ratingKey,
    videoRef,
    hlsLoader,
    prefsRef,
    setIsBuffering,
    setPlaybackError,
  );

  // Direct play failure tracking
  const directPlayFailedRef = useRef(false);
  // Monotonic init generation. Each initPlayback claims the next value and
  // its async continuations check ownership before touching the video
  // element or React state; the per-ratingKey cleanup bumps it so a
  // superseded init stops at its next checkpoint.
  const initGenRef = useRef(0);
  // Track if current playback is from a local download (for offline watch sync)
  const isLocalPlaybackRef = useRef(false);
  // Media part id of the current file — needed to persist subtitle selection
  // on the server after an on-demand download.
  const partIdRef = useRef<number | undefined>(undefined);

  // Refs for values used in initPlayback but that shouldn't trigger re-init
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const offsetOverrideRef = useRef(offsetOverride);
  offsetOverrideRef.current = offsetOverride;

  // Keep timeline refs in sync
  useEffect(() => { timeline.currentTimeRef.current = currentTime; }, [currentTime, timeline]);
  useEffect(() => { timeline.durationRef.current = duration; }, [duration, timeline]);
  useEffect(() => { timeline.isPlayingRef.current = isPlaying; }, [isPlaying, timeline]);

  // ── Initialize playback ──
  const initPlayback = useCallback(async () => {
    const gen = ++initGenRef.current;
    if (!server || !ratingKey) {
      setIsLoading(false);
      setPlaybackError("No server or media selected");
      return;
    }
    timeline.ratingKeyRef.current = ratingKey;

    setIsLoading(true);
    setPlaybackError(null);

    try {
      const prepared = await prepareSource({
        server,
        ratingKey,
        preferences: prefsRef.current.playback,
        offsetOverride: offsetOverrideRef.current,
        directPlayFailed: directPlayFailedRef.current,
        skipCodecCheck: false,
      });
      if (gen !== initGenRef.current) {
        logger.debug("player", "initPlayback superseded", { gen });
        return;
      }

      applyPreparedMetadata(prepared, {
        setTitle,
        setSubtitle,
        setChapters,
        setMarkers,
        setItemType,
        setParentRatingKey,
        setAudioTracks: streams.setAudioTracks,
        setSubtitleTracks: streams.setSubtitleTracks,
        setSelectedAudioId: streams.setSelectedAudioId,
        setSelectedSubtitleId: streams.setSelectedSubtitleId,
        setIsLocalPlayback: (v) => { isLocalPlaybackRef.current = v; },
        setPartId: (v) => { partIdRef.current = v; },
      });

      const video = videoRef.current;
      if (!video) {
        setIsLoading(false);
        setPlaybackError("Video element not available — try reloading");
        return;
      }

      video.volume = Math.min(volumeRef.current, 1);
      video.muted = isMutedRef.current;

      if (prepared.sourceKind === "local") {
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        if (gen !== initGenRef.current) {
          logger.debug("player", "initPlayback superseded", { gen });
          return;
        }
        const localUrl = convertFileSrc(prepared.url);
        hlsLoader.destroyHls();
        video.src = localUrl;
        if (prepared.viewOffset > 0) video.currentTime = prepared.viewOffset / 1000;
        video.play().catch(() => {});
        setIsLoading(false);
        timeline.startTimeline();
        return;
      }

      if (prepared.sourceKind === "direct") {
        hlsLoader.destroyHls();
        video.src = prepared.url;
        if (prepared.viewOffset > 0) video.currentTime = prepared.viewOffset / 1000;
        video.play().catch(() => {});
      } else {
        const Hls = await hlsLoader.loadHls();
        if (gen !== initGenRef.current) {
          logger.debug("player", "initPlayback superseded", { gen });
          return;
        }
        if (!Hls.isSupported()) {
          throw new Error("HLS playback is not supported in this browser/webview");
        }

        hlsLoader.destroyHls();

        const hlsConfig = buildHlsConfig(server.accessToken, {
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
        });
        const hls = new Hls(hlsConfig);

        hls.loadSource(prepared.url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          // Seek to resume position after manifest is ready
          if (prepared.viewOffset > 0) {
            video.currentTime = prepared.viewOffset / 1000;
          }
          video.play().catch(() => {});
        });

        let mediaRecoveryAttempts = 0;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          const details = [
            `fatal: ${data.fatal}`,
            `type: ${data.type}`,
            `details: ${data.details}`,
            data.url ? `url: ${redactUrl(data.url)}` : null,
            data.response ? `response: ${JSON.stringify({ code: data.response.code, text: data.response.text })}` : null,
            data.error ? `error: ${data.error.message ?? data.error}` : null,
            data.reason ? `reason: ${data.reason}` : null,
          ].filter(Boolean).join("\n");

          logger.warn("player", `HLS ${data.fatal ? "fatal" : "non-fatal"} error`, details);

          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                setPlaybackError(`Network error — could not load stream\n${details}`);
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                if (mediaRecoveryAttempts < 3) {
                  mediaRecoveryAttempts++;
                  hls.recoverMediaError();
                } else if (mediaRecoveryAttempts < 6) {
                  // After 3 failed recoveries, skip ahead 10s past the bad segment
                  mediaRecoveryAttempts++;
                  const skipTime = (videoRef.current?.currentTime ?? 0) + 10;
                  hls.recoverMediaError();
                  if (videoRef.current) videoRef.current.currentTime = skipTime;
                } else {
                  setPlaybackError(`Media error — could not decode stream\n${details}`);
                }
                break;
              default:
                setPlaybackError(`Playback error — stream could not be loaded\n${details}`);
                hls.destroy();
                break;
            }
          }
        });

        hlsLoader.hlsRef.current = hls;
      }

      timeline.startTimeline();
      setIsLoading(false);
    } catch (err) {
      if (gen !== initGenRef.current) {
        logger.debug("player", "initPlayback superseded", { gen });
        return;
      }
      setPlaybackError(err instanceof Error ? err.message : "Failed to start playback");
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- streams setters are stable useState refs
  }, [server, ratingKey, hlsLoader, timeline]);

  // Init on mount / when ratingKey changes
  useEffect(() => {
    directPlayFailedRef.current = false;
    initPlayback();
    return () => {
      initGenRef.current++;
      hlsLoader.destroyHls();
      timeline.stopTimeline();
      timeline.reportStopped();
    };
  }, [initPlayback]);

  // Keep a ref to initPlayback so event listeners don't need it as a dependency
  const initPlaybackRef = useRef(initPlayback);
  initPlaybackRef.current = initPlayback;

  // ── Video event listeners ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onDurationChange = () => {
      if (video.duration && isFinite(video.duration)) {
        setDuration(video.duration);
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      // Queue offline watch sync for locally-played downloaded items
      if (isLocalPlaybackRef.current && timeline.ratingKeyRef.current) {
        addPendingWatchSync(timeline.ratingKeyRef.current);
      }
      if (server) {
        reportTimeline(
          server.uri,
          server.accessToken,
          timeline.ratingKeyRef.current,
          "stopped",
          timeline.currentTimeRef.current * 1000,
          timeline.durationRef.current * 1000,
        );
      }
    };
    const onError = () => {
      if (video.error) {
        if (!directPlayFailedRef.current && !hlsLoader.hlsRef.current) {
          directPlayFailedRef.current = true;
          initPlaybackRef.current();
          return;
        }
        setPlaybackError(`Video error: ${video.error.message || "Unknown error"}`);
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
    };
  }, [server, hlsLoader, timeline]);

  // ── Fullscreen listener ──
  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // ── Actions ──

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const seek = useCallback(
    async (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clampedTime = Math.max(0, Math.min(time, video.duration || 0));

      // Simply set currentTime — hls.js handles seeking natively by requesting
      // the correct segments. No need to rebuild the transcode session.
      video.currentTime = clampedTime;
    },
    [],
  );

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(2, vol));
    setVolumeState(clamped);
    saveVolume(clamped);
    const video = videoRef.current;
    if (video) {
      video.volume = Math.min(clamped, 1);
      if (clamped > 0 && video.muted) {
        video.muted = false;
        setIsMuted(false);
        saveMuted(false);
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    saveMuted(video.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  const retry = useCallback(() => {
    directPlayFailedRef.current = false;
    setPlaybackError(null);
    initPlayback();
  }, [initPlayback]);

  // After an on-demand subtitle download: poll metadata for the new stream,
  // persist it as the part default (Plex deletes an unselected on-demand
  // download), then select it. selectSubtitleTrack rebuilds the HLS session
  // at the current position, so playback resumes where it was.
  const refreshSubtitlesAfterDownload = useCallback(async () => {
    if (!server) return;
    await refreshDownloadedSubtitles({
      server,
      ratingKey,
      partIdRef,
      initGenRef,
      prevSubIds: streams.subtitleTracks.map((t) => t.id),
      onTracksUpdated: streams.setSubtitleTracks,
      // HTML5 path: await so HLS rebuild completes before returning.
      onSelectSubtitle: (id) => streams.selectSubtitleTrack(id),
    });
  }, [server, ratingKey, streams]);

  // ── Backend dispatch methods ──────────────────────────────────────────────
  const pause = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  const unload = useCallback(async () => {
    // HTML5 path: unmount cleanup tears down hls.js + timeline. Nothing
    // synchronous needed here. Keep the Promise so callers can await without
    // branching.
    logger.debug("player", "html5 unload (no-op)");
  }, []);

  const setFullscreen = useCallback(async (fullscreen: boolean) => {
    if (fullscreen) {
      await document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
  }, []);

  const subscribeToEof = useCallback((handler: () => void) => {
    const video = videoRef.current;
    if (!video) return () => {};
    video.addEventListener("ended", handler);
    return () => video.removeEventListener("ended", handler);
  }, []);

  // HTML5 sub-style: maintain a <style id="prexu-subtitle-style"> tag so
  // ::cue rules style WebVTT/native text tracks rendered by the browser.
  // The native path uses libass through invoke; here we own the DOM
  // insertion ourselves so Player.tsx doesn't have to know which backend
  // it's driving.
  const applySubtitleStyle = useCallback(
    ({ style }: { size: number; style: SubtitleStylePreferences }) => {
      const id = "prexu-subtitle-style";
      let styleEl = document.getElementById(id) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = id;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = buildSubtitleCss(style);
    },
    [],
  );

  // HTML5 path: audio enhancement runs through the Web Audio graph in
  // useAudioEnhancements (volume boost, normalization, delay). No backend
  // IPC needed — this method is a no-op so consumers can call it
  // unconditionally. The Web Audio side is still updated by Player.tsx.
  const applyAudioEnhancement = useCallback(
    (_changes: { normalizationPreset?: NormalizationPreset; audioOffsetMs?: number }) => {
      // intentional no-op — Web Audio path is the authoritative chain
    },
    [],
  );

  // Clean up the injected <style> tag on unmount so navigating away from
  // the player doesn't leave global ::cue CSS in <head>.
  useEffect(() => {
    return () => {
      document.getElementById("prexu-subtitle-style")?.remove();
    };
  }, []);

  // Tick-stable slice: memoized over stable callbacks + rarely-changing
  // state only. currentTime/buffered are deliberately excluded so chrome
  // consumers (transport buttons, menus, effects) don't churn at 4 Hz.
  const chrome = useMemo<PlayerChrome>(
    () => ({
      videoRef,
      title,
      subtitle,
      chapters,
      markers,
      itemType,
      parentRatingKey,
      isLoading,
      isPlaying,
      isBuffering,
      duration,
      volume,
      isMuted,
      isFullscreen,
      playbackError,
      audioTracks: streams.audioTracks,
      subtitleTracks: streams.subtitleTracks,
      selectedAudioId: streams.selectedAudioId,
      selectedSubtitleId: streams.selectedSubtitleId,
      togglePlay,
      seek,
      setVolume,
      toggleMute,
      toggleFullscreen,
      selectAudioTrack: streams.selectAudioTrack,
      selectSubtitleTrack: streams.selectSubtitleTrack,
      retry,
      refreshSubtitlesAfterDownload,
      pause,
      unload,
      setFullscreen,
      subscribeToEof,
      applySubtitleStyle,
      applyAudioEnhancement,
      engine: "html5",
    }),
    [
      title,
      subtitle,
      chapters,
      markers,
      itemType,
      parentRatingKey,
      isLoading,
      isPlaying,
      isBuffering,
      duration,
      volume,
      isMuted,
      isFullscreen,
      playbackError,
      streams.audioTracks,
      streams.subtitleTracks,
      streams.selectedAudioId,
      streams.selectedSubtitleId,
      togglePlay,
      seek,
      setVolume,
      toggleMute,
      toggleFullscreen,
      streams.selectAudioTrack,
      streams.selectSubtitleTrack,
      retry,
      refreshSubtitlesAfterDownload,
      pause,
      unload,
      setFullscreen,
      subscribeToEof,
      applySubtitleStyle,
      applyAudioEnhancement,
    ],
  );

  return useMemo<UsePlayerResult>(
    () => ({ ...chrome, currentTime, buffered, chrome }),
    [chrome, currentTime, buffered],
  );
}
