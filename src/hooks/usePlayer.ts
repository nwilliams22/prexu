/**
 * Core playback hook — manages video element, hls.js, playback state,
 * stream tracks, and timeline reporting to Plex.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type HlsType from "hls.js";
import { useAuth } from "./useAuth";
import { usePreferences } from "./usePreferences";
import { getItemMetadata } from "../services/plex-library";
import {
  canDirectPlay,
  buildDirectPlayUrl,
  buildTranscodeUrl,
  buildHlsConfig,
  categorizeStreams,
  reportTimeline,
  reportTimelineBeacon,
  getSavedVolume,
  saveVolume,
} from "../services/plex-playback";
import type {
  PlexMediaItem,
  PlexMovie,
  PlexEpisode,
  PlexStream,
} from "../types/library";

const TIMELINE_INTERVAL_MS = 10_000;

export interface UsePlayerResult {
  // Refs
  videoRef: React.RefObject<HTMLVideoElement | null>;

  // Metadata
  title: string;
  subtitle: string; // e.g., "S01E05 — Episode Title" or year

  // Playback state
  isLoading: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  buffered: number; // buffered end in seconds
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  playbackError: string | null;

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

export function usePlayer(ratingKey: string): UsePlayerResult {
  const { server } = useAuth();
  const { preferences } = usePreferences();
  const prefsRef = useRef(preferences);
  prefsRef.current = preferences;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const HlsCtorRef = useRef<typeof HlsType | null>(null);
  const timelineRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ratingKeyRef = useRef(ratingKey);

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

  // Streams
  const [audioTracks, setAudioTracks] = useState<PlexStream[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<PlexStream[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(null);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<number | null>(
    null
  );

  // Internal refs for timeline reporting
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // ── Cleanup helper ──
  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  // ── Load hls.js dynamically ──
  const loadHls = useCallback(async (): Promise<typeof HlsType> => {
    if (HlsCtorRef.current) return HlsCtorRef.current;
    const { default: Hls } = await import("hls.js");
    HlsCtorRef.current = Hls;
    return Hls;
  }, []);

  // ── Timeline reporting ──
  const startTimeline = useCallback(() => {
    if (timelineRef.current) clearInterval(timelineRef.current);
    if (!server) return;

    timelineRef.current = setInterval(() => {
      if (isPlayingRef.current) {
        reportTimeline(
          server.uri,
          server.accessToken,
          ratingKeyRef.current,
          "playing",
          currentTimeRef.current * 1000,
          durationRef.current * 1000
        );
      }
    }, TIMELINE_INTERVAL_MS);
  }, [server]);

  const stopTimeline = useCallback(() => {
    if (timelineRef.current) {
      clearInterval(timelineRef.current);
      timelineRef.current = null;
    }
  }, []);

  // ── Initialize playback ──
  const initPlayback = useCallback(async () => {
    if (!server || !ratingKey) return;
    ratingKeyRef.current = ratingKey;

    setIsLoading(true);
    setPlaybackError(null);

    try {
      // Fetch full metadata
      const item = await getItemMetadata<PlexMediaItem>(
        server.uri,
        server.accessToken,
        ratingKey
      );

      // Set display title
      if (item.type === "episode") {
        const ep = item as PlexEpisode;
        setTitle(ep.grandparentTitle);
        setSubtitle(
          `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")} — ${ep.title}`
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

      // Categorize streams
      const streams = categorizeStreams(part);
      setAudioTracks(streams.audio);
      setSubtitleTracks(streams.subtitles);

      // Set default selected tracks (prefer user language settings)
      const pb = prefsRef.current.playback;
      let defaultAudio: PlexStream | undefined;
      if (pb.preferredAudioLanguage) {
        defaultAudio = streams.audio.find(
          (s) => s.languageCode === pb.preferredAudioLanguage
        );
      }
      if (!defaultAudio) {
        defaultAudio = streams.audio.find((s) => s.selected);
      }
      setSelectedAudioId(defaultAudio?.id ?? streams.audio[0]?.id ?? null);

      let defaultSub: PlexStream | undefined;
      if (pb.defaultSubtitles === "off") {
        defaultSub = undefined;
      } else if (pb.defaultSubtitles === "always" && pb.preferredSubtitleLanguage) {
        defaultSub = streams.subtitles.find(
          (s) => s.languageCode === pb.preferredSubtitleLanguage
        ) ?? streams.subtitles[0];
      } else {
        // "auto" — use Plex server's default selection
        defaultSub = streams.subtitles.find((s) => s.selected);
      }
      setSelectedSubtitleId(defaultSub?.id ?? null);

      // Get resume position
      const viewOffset = playableItem.viewOffset ?? 0;

      const video = videoRef.current;
      if (!video) return;

      // Set volume
      video.volume = volume;
      video.muted = isMuted;

      // Direct play decision based on preferences
      const shouldDirectPlay =
        pb.directPlayPreference === "always" ||
        (pb.directPlayPreference === "auto" &&
          (pb.quality === "original" || canDirectPlay(media)));
      const forceTranscode = pb.directPlayPreference === "never";

      if (shouldDirectPlay && !forceTranscode && canDirectPlay(media)) {
        // Direct Play — native <video>
        const url = buildDirectPlayUrl(
          server.uri,
          server.accessToken,
          part.key
        );
        destroyHls();
        video.src = url;

        if (viewOffset > 0) {
          video.currentTime = viewOffset / 1000;
        }

        video.play().catch(() => {
          // Autoplay blocked — user will click play
        });
      } else {
        // HLS Transcode — dynamically load hls.js
        const Hls = await loadHls();

        if (!Hls.isSupported()) {
          throw new Error(
            "HLS playback is not supported in this browser/webview"
          );
        }

        const hlsUrl = await buildTranscodeUrl(
          server.uri,
          server.accessToken,
          ratingKey,
          {
            offset: viewOffset > 0 ? viewOffset : undefined,
            audioStreamId: defaultAudio?.id,
            subtitleStreamId: defaultSub?.id,
            quality: pb.quality,
            subtitleSize: pb.subtitleSize,
            audioBoost: pb.audioBoost,
          }
        );

        destroyHls();

        const hlsConfig = await buildHlsConfig(server.accessToken, {
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startPosition: viewOffset > 0 ? viewOffset / 1000 : -1,
        });
        const hls = new Hls(hlsConfig);

        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {
            // Autoplay blocked
          });
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                setPlaybackError("Network error — could not load stream");
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                // Try to recover
                hls.recoverMediaError();
                break;
              default:
                setPlaybackError("Playback error — stream could not be loaded");
                hls.destroy();
                break;
            }
          }
        });

        hlsRef.current = hls;
      }

      // Start timeline reporting
      startTimeline();
      setIsLoading(false);
    } catch (err) {
      setPlaybackError(
        err instanceof Error ? err.message : "Failed to start playback"
      );
      setIsLoading(false);
    }
  }, [
    server,
    ratingKey,
    volume,
    isMuted,
    destroyHls,
    loadHls,
    startTimeline,
  ]);

  // Init on mount
  useEffect(() => {
    initPlayback();
    return () => {
      destroyHls();
      stopTimeline();
      // Report stopped on unmount
      if (server && durationRef.current > 0) {
        reportTimelineBeacon(
          server.uri,
          server.accessToken,
          ratingKeyRef.current,
          currentTimeRef.current * 1000,
          durationRef.current * 1000
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratingKey]);

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
      // Update buffered
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
      if (server) {
        reportTimeline(
          server.uri,
          server.accessToken,
          ratingKeyRef.current,
          "stopped",
          currentTimeRef.current * 1000,
          durationRef.current * 1000
        );
      }
    };
    const onError = () => {
      if (video.error) {
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
  }, [server]);

  // ── Fullscreen listener ──
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  // ── Actions ──

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(time, video.duration || 0));
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolumeState(clamped);
    saveVolume(clamped);
    const video = videoRef.current;
    if (video) {
      video.volume = clamped;
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
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  const selectAudioTrack = useCallback(
    async (streamId: number) => {
      if (!server || streamId === selectedAudioId) return;
      setSelectedAudioId(streamId);

      // For HLS, we need to rebuild the transcode URL with the new stream
      if (hlsRef.current) {
        const Hls = await loadHls();
        const savedTime = videoRef.current?.currentTime ?? 0;
        destroyHls();
        setIsBuffering(true);

        const pb = prefsRef.current.playback;
        const url = await buildTranscodeUrl(
          server.uri,
          server.accessToken,
          ratingKey,
          {
            offset: Math.round(savedTime * 1000),
            audioStreamId: streamId,
            subtitleStreamId: selectedSubtitleId ?? undefined,
            quality: pb.quality,
            subtitleSize: pb.subtitleSize,
            audioBoost: pb.audioBoost,
          }
        );

        const hlsConfig = await buildHlsConfig(server.accessToken, {
          maxBufferLength: 30,
          startPosition: savedTime,
        });
        const hls = new Hls(hlsConfig);

        hls.loadSource(url);
        hls.attachMedia(videoRef.current!);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoRef.current?.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && data.type !== Hls.ErrorTypes.MEDIA_ERROR) {
            setPlaybackError("Failed to switch audio track");
          }
        });

        hlsRef.current = hls;
      }
    },
    [server, ratingKey, selectedAudioId, selectedSubtitleId, destroyHls, loadHls]
  );

  const selectSubtitleTrack = useCallback(
    async (streamId: number | null) => {
      if (!server || streamId === selectedSubtitleId) return;
      setSelectedSubtitleId(streamId);

      // For HLS, rebuild transcode URL
      if (hlsRef.current) {
        const Hls = await loadHls();
        const savedTime = videoRef.current?.currentTime ?? 0;
        destroyHls();
        setIsBuffering(true);

        const pb = prefsRef.current.playback;
        const url = await buildTranscodeUrl(
          server.uri,
          server.accessToken,
          ratingKey,
          {
            offset: Math.round(savedTime * 1000),
            audioStreamId: selectedAudioId ?? undefined,
            subtitleStreamId: streamId ?? undefined,
            quality: pb.quality,
            subtitleSize: pb.subtitleSize,
            audioBoost: pb.audioBoost,
          }
        );

        const hlsConfig = await buildHlsConfig(server.accessToken, {
          maxBufferLength: 30,
          startPosition: savedTime,
        });
        const hls = new Hls(hlsConfig);

        hls.loadSource(url);
        hls.attachMedia(videoRef.current!);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoRef.current?.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && data.type !== Hls.ErrorTypes.MEDIA_ERROR) {
            setPlaybackError("Failed to switch subtitle track");
          }
        });

        hlsRef.current = hls;
      }
    },
    [server, ratingKey, selectedAudioId, selectedSubtitleId, destroyHls, loadHls]
  );

  const retry = useCallback(() => {
    setPlaybackError(null);
    initPlayback();
  }, [initPlayback]);

  return {
    videoRef,
    title,
    subtitle,
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
    audioTracks,
    subtitleTracks,
    selectedAudioId,
    selectedSubtitleId,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    toggleFullscreen,
    selectAudioTrack,
    selectSubtitleTrack,
    retry,
  };
}
