/**
 * Native (libmpv-backed) playback hook — Windows path for Phase 2.
 *
 * Replaces the HTML5 `<video>` + hls.js bindings with Tauri commands +
 * `player://*` event subscriptions. Returns the same `UsePlayerResult` shape
 * as `usePlayer` so PlayerControls, watch-together hooks, and the post-play
 * screen compile unchanged.
 *
 * Step 2.6 will refactor `usePlayer` to delegate here on Windows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAuth } from "../useAuth";
import { usePreferences } from "../usePreferences";
import { useTimelineReporting } from "./useTimelineReporting";
import { getItemMetadata } from "../../services/plex-library";
import { getLocalFilePath } from "../../services/downloads";
import { addPendingWatchSync } from "../../services/storage";
import {
  buildDirectPlayUrl,
  buildTranscodeUrl,
  categorizeStreams,
  reportTimeline,
  getSavedVolume,
  saveVolume,
} from "../../services/plex-playback";
import type {
  PlexMediaItem,
  PlexMovie,
  PlexEpisode,
  PlexStream,
  PlexChapter,
  PlexMarker,
} from "../../types/library";
import type { UsePlayerResult } from "../usePlayer";
import { logger } from "../../services/logger";

export function useNativePlayer(
  ratingKey: string,
  offsetOverride?: number | null,
): UsePlayerResult {
  const { server } = useAuth();
  const { preferences } = usePreferences();
  const prefsRef = useRef(preferences);
  prefsRef.current = preferences;

  // Phantom ref for type compat with HTML5 path. Native player has no DOM
  // <video>; the few consumers that touch this (PiP, video click handler)
  // are skipped on the native path.
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const timeline = useTimelineReporting(server);

  // Metadata
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");

  // Playback state
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, _setBuffered] = useState(0); // populated in step 3.10
  const [volume, setVolumeState] = useState(getSavedVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // Media info
  const [chapters, setChapters] = useState<PlexChapter[]>([]);
  const [markers, setMarkers] = useState<PlexMarker[]>([]);
  const [itemType, setItemType] = useState("");

  // Streams
  const [audioTracks, setAudioTracks] = useState<PlexStream[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<PlexStream[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(null);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<number | null>(null);

  // Refs that don't trigger re-init
  const directPlayFailedRef = useRef(false);
  const isLocalPlaybackRef = useRef(false);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const offsetOverrideRef = useRef(offsetOverride);
  offsetOverrideRef.current = offsetOverride;

  // Keep timeline refs in sync
  useEffect(() => {
    timeline.currentTimeRef.current = currentTime;
  }, [currentTime, timeline]);
  useEffect(() => {
    timeline.durationRef.current = duration;
  }, [duration, timeline]);
  useEffect(() => {
    timeline.isPlayingRef.current = isPlaying;
  }, [isPlaying, timeline]);

  // ── Subscribe to native player events ──
  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    (async () => {
      logger.debug("player", "subscribing to native events");
      const subs = await Promise.all([
        listen<number>("player://time-pos", (e) => setCurrentTime(e.payload)),
        listen<number>("player://duration", (e) => setDuration(e.payload)),
        listen<boolean>("player://paused", (e) => setIsPlaying(!e.payload)),
        listen<boolean>("player://buffering", (e) => setIsBuffering(e.payload)),
        listen<null>("player://ready", () => {
          logger.info("player", "received ready event");
          setIsLoading(false);
          setIsBuffering(false);
        }),
        listen<null>("player://eof", () => {
          logger.info("player", "received eof event");
          setIsPlaying(false);
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
        }),
        listen<string>("player://error", (e) => {
          logger.error("player", "received error event", e.payload);
          setPlaybackError(`Player error: ${e.payload}`);
        }),
        listen<boolean>("player://fullscreen", (e) => {
          logger.debug("player", "received fullscreen event", e.payload);
          setIsFullscreen(e.payload);
        }),
      ]);
      if (cancelled) {
        for (const u of subs) u();
      } else {
        unlisteners = subs;
      }
    })();

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- timeline refs are stable
  }, [server]);

  // ── Initialize playback ──
  const initPlayback = useCallback(async () => {
    logger.info("player", "initPlayback", { ratingKey });
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

      const playableItem = item as PlexMovie | PlexEpisode;
      const media = playableItem.Media?.[0];
      if (!media || !media.Part || media.Part.length === 0) {
        throw new Error("No playable media found");
      }
      const part = media.Part[0];
      setChapters(part.Chapter ?? []);
      setMarkers(playableItem.Marker ?? []);
      setItemType(item.type);

      const categorized = categorizeStreams(part);
      setAudioTracks(categorized.audio);
      setSubtitleTracks(categorized.subtitles);

      const pb = prefsRef.current.playback;
      let defaultAudio = pb.preferredAudioLanguage
        ? categorized.audio.find((s) => s.languageCode === pb.preferredAudioLanguage)
        : undefined;
      if (!defaultAudio) defaultAudio = categorized.audio.find((s) => s.selected);
      setSelectedAudioId(defaultAudio?.id ?? categorized.audio[0]?.id ?? null);

      let defaultSub: PlexStream | undefined;
      if (pb.defaultSubtitles === "off") {
        defaultSub = undefined;
      } else if (pb.defaultSubtitles === "always" && pb.preferredSubtitleLanguage) {
        defaultSub =
          categorized.subtitles.find(
            (s) => s.languageCode === pb.preferredSubtitleLanguage,
          ) ?? categorized.subtitles[0];
      } else {
        defaultSub = categorized.subtitles.find((s) => s.selected);
      }
      setSelectedSubtitleId(defaultSub?.id ?? null);

      const viewOffset =
        offsetOverrideRef.current != null
          ? offsetOverrideRef.current
          : (playableItem.viewOffset ?? 0);

      // Pick a source URL. Local downloads first, then direct play / transcode.
      //
      // libmpv decodes every common codec/container natively, so the
      // HTML5-centric canDirectPlay() whitelist would force transcodes
      // for files mpv plays fine (e.g. HEVC in MKV). Plex transcode
      // cold-start adds 15-20 s to first-play latency on a warm server,
      // which is unacceptable. On native we Direct Play by default in
      // auto/always modes; users who need bandwidth-capped streams can
      // pick directPlayPreference="never". On Direct Play failure, we
      // fall back to transcode via directPlayFailedRef (set by the mpv
      // error path + retry).
      let url: string;
      isLocalPlaybackRef.current = false;
      const localPath = await getLocalFilePath(ratingKey).catch(() => null);
      if (localPath) {
        url = localPath; // mpv accepts raw Windows paths
        isLocalPlaybackRef.current = true;
      } else {
        const shouldDirectPlay =
          !directPlayFailedRef.current &&
          pb.directPlayPreference !== "never";

        if (shouldDirectPlay) {
          url = buildDirectPlayUrl(server.uri, server.accessToken, part.key);
          logger.debug("player", "URL chosen: direct play", {
            container: part.container,
            videoCodec: media.videoCodec,
            audioCodec: media.audioCodec,
          });
        } else {
          url = await buildTranscodeUrl(server.uri, server.accessToken, ratingKey, {
            audioStreamId: defaultAudio?.id,
            subtitleStreamId: defaultSub?.id,
            quality: pb.quality,
            subtitleSize: pb.subtitleSize,
            audioBoost: pb.audioBoost,
            audioCodec: defaultAudio?.codec ?? media.audioCodec,
          });
          logger.debug("player", "URL chosen: transcode", {
            reason: directPlayFailedRef.current ? "previous direct-play failure" : "user preference=never",
            quality: pb.quality,
          });
        }
      }

      // load_url runs ensure_init server-side which actually creates the
      // mpv handle. Volume/mute commands assume an initialised handle, so
      // they MUST come after load_url, not before.
      logger.info("player", "loading URL", { url: url.substring(0, 80), startOffsetMs: viewOffset });
      await invoke("player_load_url", {
        url,
        headers: {} as Record<string, string>,
        startOffsetMs: viewOffset,
      });
      logger.info("player", "load_url returned OK, waiting for ready event");

      // Apply saved volume + mute now that mpv exists. mpv volume is 0..200
      // (we configured volume-max=200 in PlayerState::ensure_init); our
      // `volume` state is 0..2 in float.
      await invoke("player_set_volume", {
        vol: Math.max(0, Math.min(200, Math.round(volumeRef.current * 100))),
      });
      await invoke("player_set_muted", { muted: isMutedRef.current });

      timeline.startTimeline();
      // setIsLoading(false) happens when `player://ready` fires.
    } catch (err) {
      // Tauri invoke rejects with a string (not Error) — the previous
      // `err instanceof Error` path was hiding every backend failure.
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : JSON.stringify(err);
      logger.error("player", "init failed", msg);
      setPlaybackError(msg || "Failed to start playback");
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ref values are stable
  }, [server, ratingKey, timeline]);

  // Init on mount / when ratingKey changes
  useEffect(() => {
    directPlayFailedRef.current = false;
    initPlayback();
    return () => {
      logger.info("player", "cleanup: stopping timeline, unloading");
      timeline.stopTimeline();
      timeline.reportStopped();
      // Order: unload THEN fullscreen-exit. player_unload synchronously
      // terminates mpv (see destroy() in player/mod.rs), so by the time
      // it resolves, player_set_fullscreen hits its fast path (no mpv =>
      // no transition wait, no geometry sync). Running them in parallel
      // would let the slow mpv-aware fullscreen path race with mpv
      // teardown. Errors were previously swallowed silently; if unload
      // fails now we want it in the log because audio may keep playing.
      const wasFullscreen = isFullscreenRef.current;
      invoke("player_unload")
        .catch((err) =>
          logger.error("player", "player_unload failed", String(err)),
        )
        .finally(() => {
          if (wasFullscreen) {
            invoke("player_set_fullscreen", { fullscreen: false }).catch(
              (err) =>
                logger.error(
                  "player",
                  "player_set_fullscreen(false) cleanup failed",
                  String(err),
                ),
            );
          }
        });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- timeline funcs are stable
  }, [initPlayback]);

  // Note: ESC-to-exit-fullscreen via Tauri doesn't fire a JS event back, so
  // isFullscreen can drift if the user uses a chrome-side gesture. Phase 4
  // polish can add an explicit window-event listener if it matters.

  // ── Actions ──
  const togglePlay = useCallback(() => {
    logger.debug("player", isPlaying ? "pause" : "play");
    invoke(isPlaying ? "player_pause" : "player_play").catch(() => {});
  }, [isPlaying]);

  const seek = useCallback((time: number) => {
    logger.debug("player", "seek", { seconds: time });
    invoke("player_seek", { seconds: time }).catch(() => {});
  }, []);

  const setVolume = useCallback(
    (vol: number) => {
      const clamped = Math.max(0, Math.min(2, vol));
      logger.debug("player", "setVolume", { volume: clamped });
      setVolumeState(clamped);
      saveVolume(clamped);
      invoke("player_set_volume", {
        vol: Math.max(0, Math.min(200, Math.round(clamped * 100))),
      }).catch(() => {});
      if (clamped > 0 && isMutedRef.current) {
        setIsMuted(false);
        invoke("player_set_muted", { muted: false }).catch(() => {});
      }
    },
    [],
  );

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    setIsMuted(next);
    invoke("player_set_muted", { muted: next }).catch(() => {});
  }, []);

  const isFullscreenRef = useRef(isFullscreen);
  isFullscreenRef.current = isFullscreen;
  const toggleFullscreen = useCallback(() => {
    const next = !isFullscreenRef.current;
    logger.info("player", "toggleFullscreen", { current: isFullscreenRef.current, next });
    setIsFullscreen(next);
    invoke("player_set_fullscreen", { fullscreen: next })
      .then(() => logger.debug("player", "fullscreen command completed"))
      .catch((err) => {
        logger.error("player", "fullscreen command failed", String(err));
        setIsFullscreen(!next);
      });
  }, []);

  const selectAudioTrack = useCallback((streamId: number) => {
    setSelectedAudioId(streamId);
    invoke("player_set_audio_track", { id: streamId }).catch(() => {});
  }, []);

  const selectSubtitleTrack = useCallback((streamId: number | null) => {
    setSelectedSubtitleId(streamId);
    invoke("player_set_sub_track", { id: streamId }).catch(() => {});
  }, []);

  const retry = useCallback(() => {
    directPlayFailedRef.current = false;
    setPlaybackError(null);
    initPlayback();
  }, [initPlayback]);

  return useMemo<UsePlayerResult>(
    () => ({
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
    }),
    [
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
    ],
  );
}
