/**
 * Core playback hook. Dispatches to one of two backends per platform:
 * - Windows (Tauri): `useNativePlayer` — libmpv via player://* events
 * - everywhere else: HTML5 `<video>` + hls.js (the original implementation
 *   below, renamed `useHtml5Player`)
 *
 * Both backends return the same `UsePlayerResult` so PlayerControls,
 * watch-together hooks, and the post-play screen don't care which is active.
 *
 * The dispatch decision is a module-level constant set once at import time
 * (so React always calls the same hook for any given component instance —
 * the rules-of-hooks invariant holds even though the call site is a
 * ternary).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "./useAuth";
import { usePreferences } from "./usePreferences";
import { useHlsLoader } from "./player/useHlsLoader";
import { useTimelineReporting } from "./player/useTimelineReporting";
import { useStreamSelection } from "./player/useStreamSelection";
import { useNativePlayer } from "./player/useNativePlayer";
import { addPendingWatchSync } from "../services/storage";
import {
  prepareSource,
  deriveDisplayTitles,
  buildHlsConfig,
  reportTimeline,
  getSavedVolume,
  saveVolume,
} from "../services/plex-playback";
import {
  setSelectedSubtitleStream,
  waitForDownloadedSubtitle,
} from "../services/subtitle-search";
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
import { logger } from "../services/logger";

export const IS_NATIVE_PLAYER =
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window &&
  typeof navigator !== "undefined" &&
  navigator.userAgent.includes("Windows");

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
}

export function usePlayer(ratingKey: string, offsetOverride?: number | null): UsePlayerResult {
  // The branch is a module-level constant — React calls the same hook for
  // any given component instance across renders, so rules-of-hooks holds.
  return IS_NATIVE_PLAYER
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
  const [isMuted, setIsMuted] = useState(false);
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

      const { title: t, subtitle: s } = deriveDisplayTitles(prepared.item);
      setTitle(t);
      setSubtitle(s);

      setChapters(prepared.part.Chapter ?? []);
      partIdRef.current = prepared.part.id;
      setMarkers(prepared.playable.Marker ?? []);
      setItemType(prepared.item.type);
      setParentRatingKey(
        prepared.item.type === "episode"
          ? (prepared.playable as import("../types/library").PlexEpisode).parentRatingKey ?? ""
          : "",
      );

      streams.setAudioTracks(prepared.categorized.audio);
      streams.setSubtitleTracks(prepared.categorized.subtitles);
      streams.setSelectedAudioId(prepared.defaultAudio?.id ?? prepared.categorized.audio[0]?.id ?? null);
      streams.setSelectedSubtitleId(prepared.defaultSub?.id ?? null);

      isLocalPlaybackRef.current = prepared.isLocal;

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
            data.url ? `url: ${data.url.substring(0, 80)}` : null,
            data.response ? `response: ${JSON.stringify({ code: data.response.code, text: data.response.text })}` : null,
            data.error ? `error: ${data.error.message ?? data.error}` : null,
            data.reason ? `reason: ${data.reason}` : null,
          ].filter(Boolean).join("\n");

          console.warn(`[HLS Error] ${data.fatal ? "FATAL" : "non-fatal"}`, details);

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
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
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
    const prevIds = streams.subtitleTracks.map((t) => t.id);
    const result = await waitForDownloadedSubtitle(
      server.uri,
      server.accessToken,
      ratingKey,
      partIdRef.current,
      prevIds,
    );
    if (!result) return;
    streams.setSubtitleTracks(result.tracks);
    if (partIdRef.current !== undefined) {
      try {
        await setSelectedSubtitleStream(
          server.uri,
          server.accessToken,
          partIdRef.current,
          result.added.id,
        );
      } catch (err) {
        logger.error("player", "persist downloaded subtitle failed", String(err));
      }
    }
    logger.info("player", "applying downloaded subtitle", { streamId: result.added.id });
    await streams.selectSubtitleTrack(result.added.id);
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

  return {
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
    currentTime,
    duration,
    buffered,
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
  };
}
