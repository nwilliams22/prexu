/**
 * Core playback hook — manages video element, hls.js, playback state,
 * stream tracks, and timeline reporting to Plex.
 *
 * Composes sub-hooks for HLS management, timeline reporting, and stream selection.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "./useAuth";
import { usePreferences } from "./usePreferences";
import { useHlsLoader } from "./player/useHlsLoader";
import { useTimelineReporting } from "./player/useTimelineReporting";
import { useStreamSelection } from "./player/useStreamSelection";
import { getItemMetadata } from "../services/plex-library";
import { getLocalFilePath } from "../services/downloads";
import { addPendingWatchSync } from "../services/storage";
import {
  canDirectPlay,
  buildDirectPlayUrl,
  buildTranscodeUrl,
  buildHlsConfig,
  categorizeStreams,
  reportTimeline,
  getSavedVolume,
  saveVolume,
} from "../services/plex-playback";
import type {
  PlexMediaItem,
  PlexMovie,
  PlexEpisode,
  PlexStream,
  PlexChapter,
  PlexMarker,
} from "../types/library";

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
}

export function usePlayer(ratingKey: string, offsetOverride?: number | null): UsePlayerResult {
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
      const item = await getItemMetadata<PlexMediaItem>(
        server.uri,
        server.accessToken,
        ratingKey,
      );

      // Set display title
      if (item.type === "episode") {
        const ep = item as PlexEpisode;
        setTitle(ep.grandparentTitle);
        setSubtitle(
          `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")} — ${ep.title}`,
        );
      } else if (item.type === "movie") {
        const movie = item as PlexMovie;
        setTitle(movie.title);
        setSubtitle(movie.year ? String(movie.year) : "");
      } else {
        setTitle(item.title);
        setSubtitle("");
      }

      // Get media info
      const playableItem = item as PlexMovie | PlexEpisode;
      const media = playableItem.Media?.[0];
      if (!media || !media.Part || media.Part.length === 0) {
        throw new Error("No playable media found");
      }

      const part = media.Part[0];
      setChapters(part.Chapter ?? []);
      setMarkers(playableItem.Marker ?? []);
      setItemType(item.type);

      // Categorize and set default streams
      const categorized = categorizeStreams(part);
      streams.setAudioTracks(categorized.audio);
      streams.setSubtitleTracks(categorized.subtitles);

      const pb = prefsRef.current.playback;
      let defaultAudio = pb.preferredAudioLanguage
        ? categorized.audio.find((s) => s.languageCode === pb.preferredAudioLanguage)
        : undefined;
      if (!defaultAudio) defaultAudio = categorized.audio.find((s) => s.selected);
      streams.setSelectedAudioId(defaultAudio?.id ?? categorized.audio[0]?.id ?? null);

      let defaultSub: PlexStream | undefined;
      if (pb.defaultSubtitles === "off") {
        defaultSub = undefined;
      } else if (pb.defaultSubtitles === "always" && pb.preferredSubtitleLanguage) {
        defaultSub = categorized.subtitles.find(
          (s) => s.languageCode === pb.preferredSubtitleLanguage,
        ) ?? categorized.subtitles[0];
      } else {
        defaultSub = categorized.subtitles.find((s) => s.selected);
      }
      streams.setSelectedSubtitleId(defaultSub?.id ?? null);

      // Get resume position
      const viewOffset = offsetOverrideRef.current != null ? offsetOverrideRef.current : (playableItem.viewOffset ?? 0);

      const video = videoRef.current;
      if (!video) {
        setIsLoading(false);
        setPlaybackError("Video element not available — try reloading");
        return;
      }

      video.volume = Math.min(volumeRef.current, 1);
      video.muted = isMutedRef.current;

      // Check for downloaded local file first
      isLocalPlaybackRef.current = false;
      try {
        const localPath = await getLocalFilePath(ratingKey);
        if (localPath) {
          // Use Tauri's asset protocol to serve local files
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          const localUrl = convertFileSrc(localPath);
          hlsLoader.destroyHls();
          video.src = localUrl;
          if (viewOffset > 0) video.currentTime = viewOffset / 1000;
          video.play().catch(() => {});
          isLocalPlaybackRef.current = true;
          setIsLoading(false);
          timeline.startTimeline();
          return;
        }
      } catch {
        // Not in Tauri or no local file — continue with streaming
      }

      // Direct play decision
      const shouldDirectPlay =
        !directPlayFailedRef.current &&
        (pb.directPlayPreference === "always" ||
        (pb.directPlayPreference === "auto" &&
          (pb.quality === "original" || canDirectPlay(media))));
      const forceTranscode = pb.directPlayPreference === "never" || directPlayFailedRef.current;

      if (shouldDirectPlay && !forceTranscode && canDirectPlay(media)) {
        const url = buildDirectPlayUrl(server.uri, server.accessToken, part.key);
        hlsLoader.destroyHls();
        video.src = url;
        if (viewOffset > 0) video.currentTime = viewOffset / 1000;
        video.play().catch(() => {});
      } else {
        const Hls = await hlsLoader.loadHls();
        if (!Hls.isSupported()) {
          throw new Error("HLS playback is not supported in this browser/webview");
        }

        // Don't pass offset to Plex — start transcode from beginning.
        // We'll seek to the resume point after the manifest loads.
        const hlsUrl = await buildTranscodeUrl(
          server.uri,
          server.accessToken,
          ratingKey,
          {
            audioStreamId: defaultAudio?.id,
            subtitleStreamId: defaultSub?.id,
            quality: pb.quality,
            subtitleSize: pb.subtitleSize,
            audioBoost: pb.audioBoost,
            audioCodec: defaultAudio?.codec ?? media.audioCodec,
          },
        );

        hlsLoader.destroyHls();

        const hlsConfig = buildHlsConfig(server.accessToken, {
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
        });
        const hls = new Hls(hlsConfig);

        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          // Seek to resume position after manifest is ready
          if (viewOffset > 0) {
            video.currentTime = viewOffset / 1000;
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
  }, [server, ratingKey, hlsLoader, timeline, streams]);

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
          initPlayback();
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
  }, [server, hlsLoader, timeline, initPlayback]);

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
    [server, ratingKey, streams.selectedAudioId, streams.selectedSubtitleId, hlsLoader],
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

  return {
    videoRef,
    title,
    subtitle,
    chapters,
    markers,
    itemType,
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
  };
}
