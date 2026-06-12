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
import { addPendingWatchSync } from "../../services/storage";
import {
  prepareSource,
  deriveDisplayTitles,
  reportTimeline,
  getSavedVolume,
  saveVolume,
} from "../../services/plex-playback";
import {
  setSelectedSubtitleStream,
  waitForDownloadedSubtitle,
} from "../../services/subtitle-search";
import type {
  PlexEpisode,
  PlexStream,
  PlexChapter,
  PlexMarker,
} from "../../types/library";
import type {
  NormalizationPreset,
  SubtitleStylePreferences,
} from "../../types/preferences";
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

  // Streams
  const [audioTracks, setAudioTracks] = useState<PlexStream[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<PlexStream[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(null);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<number | null>(null);
  // Refs mirror the latest values so action callbacks can map a Plex stream
  // ID to the correct mpv track index without re-binding when the lists
  // change.
  const audioTracksRef = useRef<PlexStream[]>([]);
  audioTracksRef.current = audioTracks;
  const subtitleTracksRef = useRef<PlexStream[]>([]);
  subtitleTracksRef.current = subtitleTracks;

  // Refs that don't trigger re-init
  const directPlayFailedRef = useRef(false);
  const isLocalPlaybackRef = useRef(false);
  // Media part id of the currently playing file — needed to persist subtitle
  // selection on the server after an on-demand download.
  const partIdRef = useRef<number | undefined>(undefined);
  // External default sub URL awaiting sub-add. mpv rejects sub-add before the
  // file has loaded (MPV_ERROR_COMMAND), so the initial external subtitle is
  // buffered here and flushed in the player://ready handler.
  const pendingExternalSubRef = useRef<string | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const offsetOverrideRef = useRef(offsetOverride);
  offsetOverrideRef.current = offsetOverride;

  // ── Backend dispatch ref state ──
  // Track readiness so applySubtitleStyle / applyAudioEnhancement can defer
  // IPC until mpv exists. isLoading starts true and flips false on
  // player://ready; we mirror it in a ref so the callbacks stay stable.
  const isReadyRef = useRef(false);
  // Latest sub-style awaiting (re-)apply when mpv becomes ready. mpv only
  // accepts sub-* property writes once it has a handle, so changes that
  // arrive pre-ready are buffered here and flushed in the ready handler.
  const pendingSubStyleRef = useRef<
    { size: number; style: SubtitleStylePreferences } | null
  >(null);
  // Latest audio-enhancement state awaiting initial apply at ready time.
  // Player.tsx populates this once via applyAudioEnhancement(prefs) before
  // mpv exists; we replay it on ready so persisted prefs survive restart.
  // Subsequent user changes hit the live IPCs directly.
  const pendingAfRef = useRef<{
    normalizationPreset?: NormalizationPreset;
    audioOffsetMs?: number;
  } | null>(null);
  // Subscriber slots for the public subscribeToEof contract. Kept separate
  // from the bookkeeping listener below (addPendingWatchSync + reportTimeline
  // + setIsPlaying); these fire so consumers like usePostPlay can react to
  // EOF without each backend re-implementing the trigger.
  const eofSubscribersRef = useRef<Set<() => void>>(new Set());

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
        listen<number>("player://buffered", (e) => setBuffered(e.payload)),
        listen<null>("player://ready", () => {
          logger.info("player", "received ready event");
          isReadyRef.current = true;
          setIsLoading(false);
          setIsBuffering(false);
          // Flush the initial external default subtitle. sub-add only works
          // once mpv has an active file; initPlayback buffers the URL here
          // instead of firing it pre-load (which failed with Raw(-12)).
          const externalSub = pendingExternalSubRef.current;
          if (externalSub) {
            pendingExternalSubRef.current = null;
            logger.info("player", "ready-flush player_load_external_sub", {
              url: externalSub.substring(0, 80),
            });
            invoke("player_load_external_sub", { url: externalSub }).catch((err) =>
              logger.error("player", "ready-flush player_load_external_sub failed", String(err)),
            );
          }
          // Flush any sub-style change that arrived before mpv existed.
          // applySubtitleStyle stores the latest request in pendingSubStyleRef;
          // we replay it here so persisted prefs take effect on cold start.
          const subStyle = pendingSubStyleRef.current;
          if (subStyle) {
            const payload = {
              size: subStyle.size,
              fontFamily: subStyle.style.fontFamily,
              textColor: subStyle.style.textColor,
              backgroundColor: subStyle.style.backgroundColor,
              backgroundOpacity: subStyle.style.backgroundOpacity,
              outlineColor: subStyle.style.outlineColor,
              outlineWidth: subStyle.style.outlineWidth,
              shadowEnabled: subStyle.style.shadowEnabled,
            };
            logger.info("player", "ready-flush player_apply_sub_style", payload);
            invoke("player_apply_sub_style", { style: payload }).catch((err) =>
              logger.error("player", "ready-flush player_apply_sub_style failed", String(err)),
            );
          }
          // Flush initial audio-enhancement state. Web Audio path handles
          // its own initial values via constructor args; native needs an
          // explicit IPC pair once mpv exists. Player.tsx primes this
          // before ready fires so persisted prefs survive cold start.
          const af = pendingAfRef.current;
          if (af) {
            if (af.normalizationPreset !== undefined) {
              logger.info("player", "ready-flush player_set_af_chain", {
                preset: af.normalizationPreset,
              });
              invoke("player_set_af_chain", { preset: af.normalizationPreset }).catch(
                (err) =>
                  logger.error(
                    "player",
                    "ready-flush player_set_af_chain failed",
                    String(err),
                  ),
              );
            }
            if (af.audioOffsetMs !== undefined) {
              logger.info("player", "ready-flush player_set_audio_delay_ms", {
                ms: af.audioOffsetMs,
              });
              invoke("player_set_audio_delay_ms", { ms: af.audioOffsetMs }).catch(
                (err) =>
                  logger.error(
                    "player",
                    "ready-flush player_set_audio_delay_ms failed",
                    String(err),
                  ),
              );
            }
          }
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
          // Notify public subscribeToEof consumers. Kept separate from
          // the bookkeeping above so each side can evolve independently.
          for (const fn of eofSubscribersRef.current) {
            try {
              fn();
            } catch (err) {
              logger.error("player", "eof subscriber threw", String(err));
            }
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
    // isReadyRef intentionally NOT reset here: once mpv exists (after the
    // first player://ready), it accepts sub-* and af property writes at
    // any time, including while a new file is loading. Resetting on each
    // initPlayback would re-defer subsequent applySubtitleStyle calls
    // unnecessarily and races against the post-render dep-driven re-fire
    // of this very effect. useRef(false) gives us the correct first-mount
    // semantics for the genuine cold-start deferral case.

    try {
      const prepared = await prepareSource({
        server,
        ratingKey,
        preferences: prefsRef.current.playback,
        offsetOverride: offsetOverrideRef.current,
        directPlayFailed: directPlayFailedRef.current,
        skipCodecCheck: true,
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
          ? (prepared.playable as PlexEpisode).parentRatingKey ?? ""
          : "",
      );

      setAudioTracks(prepared.categorized.audio);
      setSubtitleTracks(prepared.categorized.subtitles);
      setSelectedAudioId(prepared.defaultAudio?.id ?? prepared.categorized.audio[0]?.id ?? null);
      setSelectedSubtitleId(prepared.defaultSub?.id ?? null);

      isLocalPlaybackRef.current = prepared.isLocal;

      logger.debug("player", "URL chosen", { kind: prepared.sourceKind, url: prepared.url.substring(0, 80) });

      // load_url runs ensure_init server-side which actually creates the
      // mpv handle. Volume/mute commands assume an initialised handle, so
      // they MUST come after load_url, not before.
      logger.info("player", "loading URL", { url: prepared.url.substring(0, 80), startOffsetMs: prepared.viewOffset });
      // Buffer the external default sub BEFORE loadfile: the ready event can
      // fire before the post-load_url code below runs (fast reloads), and
      // the ready handler is what flushes this ref via sub-add.
      pendingExternalSubRef.current = prepared.defaultSub?.key
        ? `${server.uri}${prepared.defaultSub.key}?X-Plex-Token=${server.accessToken}`
        : null;
      await invoke("player_load_url", {
        url: prepared.url,
        headers: {} as Record<string, string>,
        startOffsetMs: prepared.viewOffset,
      });
      logger.info("player", "load_url returned OK, waiting for ready event");

      // Apply saved volume + mute now that mpv exists. mpv volume is 0..200
      // (we configured volume-max=200 in PlayerState::ensure_init); our
      // `volume` state is 0..2 in float.
      await invoke("player_set_volume", {
        vol: Math.max(0, Math.min(200, Math.round(volumeRef.current * 100))),
      });
      await invoke("player_set_muted", { muted: isMutedRef.current });

      // Apply default audio and subtitle track selection. mpv picks aid=1 by
      // default which is usually fine, but the user's preferredAudioLanguage
      // may have chosen a different track that we need to apply explicitly.
      // Subtitle off vs. default also needs an explicit set_sub_track since
      // mpv's default would otherwise show the first sub track. External subs
      // (Plex sidecar .srt, recognised by the `key` field) need sub-add
      // instead — mpv only sees embedded tracks in a direct-played file.
      const { defaultAudio, defaultSub, categorized } = prepared;
      if (defaultAudio) {
        const aidIdx = categorized.audio.findIndex((s) => s.id === defaultAudio.id);
        if (aidIdx >= 0) {
          await invoke("player_set_audio_track", { id: aidIdx + 1 }).catch((err) =>
            logger.warn("player", "initial player_set_audio_track failed", String(err)),
          );
        }
      }
      if (defaultSub) {
        if (defaultSub.key) {
          // External default sub: handled by the ready-flush of
          // pendingExternalSubRef (set above, before loadfile) — sub-add
          // fails with MPV_ERROR_COMMAND before the file is loaded.
          logger.debug("player", "external default sub deferred to ready", {
            key: defaultSub.key,
          });
        } else {
          const embedded = categorized.subtitles.filter((s) => !s.key);
          const sidIdx = embedded.findIndex((s) => s.id === defaultSub!.id);
          if (sidIdx >= 0) {
            await invoke("player_set_sub_track", { id: sidIdx + 1 }).catch((err) =>
              logger.warn("player", "initial player_set_sub_track failed", String(err)),
            );
          }
        }
      } else {
        await invoke("player_set_sub_track", { id: null }).catch((err) =>
          logger.warn("player", "initial player_set_sub_track(off) failed", String(err)),
        );
      }

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

  // Init on mount / when ratingKey changes.
  //
  // Cleanup here runs on EVERY ratingKey change (autoplay handoff, manual
  // next episode, etc) AND on true unmount. It uses `player_stop` (soft
  // stop: mpv `stop` + mute, keeps mpv handle + host window alive) instead
  // of `player_unload` (full destroy) so episode handoff doesn't pay for
  // mpv terminate + DXGI swap chain rebuild + hwdec probe every time
  // (prexu-7fe). The full destroy + fullscreen exit moves to the
  // unmount-only effect below.
  useEffect(() => {
    directPlayFailedRef.current = false;
    initPlayback();
    return () => {
      logger.info("player", "cleanup: stopping timeline + soft-stop mpv");
      timeline.stopTimeline();
      timeline.reportStopped();
      invoke("player_stop").catch((err) =>
        logger.error("player", "player_stop failed", String(err)),
      );
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- timeline funcs are stable
  }, [initPlayback]);

  // True-unmount cleanup: full mpv destroy + fullscreen exit. Empty deps so
  // this only fires when the Player route actually unmounts (back to
  // dashboard, navigate away). Per-episode handoff stays soft (above).
  //
  // Why fullscreen exit lives here instead of the per-episode cleanup:
  // exiting fullscreen between autoplayed episodes drops the user out of
  // their chosen viewing mode mid-binge — never the intent.
  //
  // Order: unload THEN fullscreen-exit. player_unload's destroy()
  // synchronously silences mpv before returning, so by the time the
  // promise resolves, player_set_fullscreen hits its fast path (no mpv
  // → no transition wait, no geometry sync). Running them in parallel
  // would let the mpv-aware fullscreen path race with mpv teardown.
  useEffect(() => {
    return () => {
      logger.info("player", "unmount: full unload + fullscreen exit");
      const wasFullscreen = isFullscreenRef.current;
      invoke("player_unload")
        .catch((err) =>
          logger.error("player", "player_unload (unmount) failed", String(err)),
        )
        .finally(() => {
          if (wasFullscreen) {
            invoke("player_set_fullscreen", { fullscreen: false }).catch(
              (err) =>
                logger.error(
                  "player",
                  "player_set_fullscreen(false) unmount failed",
                  String(err),
                ),
            );
          }
        });
    };
  }, []);

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

  // Primitive setter — used by both toggleFullscreen and the public
  // setFullscreen method on UsePlayerResult. Optimistically updates React
  // state; on IPC failure we roll back so the controls match reality.
  const setFullscreen = useCallback(async (fullscreen: boolean) => {
    logger.info("player", "setFullscreen", {
      current: isFullscreenRef.current,
      next: fullscreen,
    });
    setIsFullscreen(fullscreen);
    try {
      await invoke("player_set_fullscreen", { fullscreen });
      logger.debug("player", "fullscreen command completed");
    } catch (err) {
      logger.error("player", "fullscreen command failed", String(err));
      setIsFullscreen(!fullscreen);
      throw err;
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    void setFullscreen(!isFullscreenRef.current).catch(() => {});
  }, [setFullscreen]);

  // Plex stream IDs are global Library IDs (e.g. 234567); mpv's aid/sid
  // expects 1-indexed positions in the file's track list. categorizeStreams
  // preserves the file order, so audioTracks[i] corresponds to mpv aid=i+1
  // (and same for subtitles). Map at the boundary; mpv defaults to no-op
  // if the index is out of range, so an unmapped stream silently falls back
  // to whatever was playing.
  const selectAudioTrack = useCallback((streamId: number) => {
    setSelectedAudioId(streamId);
    const idx = audioTracksRef.current.findIndex((s) => s.id === streamId);
    const aid = idx >= 0 ? idx + 1 : null;
    logger.debug("player", "selectAudioTrack", { plexId: streamId, mpvAid: aid });
    invoke("player_set_audio_track", { id: aid }).catch((err) =>
      logger.error("player", "player_set_audio_track failed", String(err)),
    );
  }, []);

  // Subtitle selection has two paths:
  // - Embedded sub (no `key` field): resolve sid by position among embedded
  //   tracks, dispatch player_set_sub_track. Externals are filtered out of
  //   the count so embedded indices match what mpv actually sees in the file.
  // - External sub (sidecar .srt etc., has `key`): build the Plex sub URL
  //   with the access token and dispatch player_load_external_sub which
  //   calls mpv sub-add. mpv appends a fresh sid for the loaded file and
  //   selects it; existing embedded sids stay stable.
  const selectSubtitleTrack = useCallback((streamId: number | null) => {
    setSelectedSubtitleId(streamId);
    if (streamId === null) {
      logger.debug("player", "selectSubtitleTrack", { plexId: null });
      invoke("player_set_sub_track", { id: null }).catch((err) =>
        logger.error("player", "player_set_sub_track(off) failed", String(err)),
      );
      return;
    }
    const sub = subtitleTracksRef.current.find((s) => s.id === streamId);
    if (sub?.key) {
      const url = `${server!.uri}${sub.key}?X-Plex-Token=${server!.accessToken}`;
      logger.debug("player", "selectSubtitleTrack external", {
        plexId: streamId,
        url: url.substring(0, 80),
      });
      invoke("player_load_external_sub", { url }).catch((err) =>
        logger.error("player", "player_load_external_sub failed", String(err)),
      );
      return;
    }
    const embedded = subtitleTracksRef.current.filter((s) => !s.key);
    const idx = embedded.findIndex((s) => s.id === streamId);
    const sid = idx >= 0 ? idx + 1 : null;
    logger.debug("player", "selectSubtitleTrack embedded", { plexId: streamId, mpvSid: sid });
    invoke("player_set_sub_track", { id: sid }).catch((err) =>
      logger.error("player", "player_set_sub_track failed", String(err)),
    );
  }, [server]);

  const retry = useCallback(() => {
    directPlayFailedRef.current = false;
    setPlaybackError(null);
    initPlayback();
  }, [initPlayback]);

  // After an on-demand subtitle download: poll metadata for the new stream,
  // persist it as the part default (Plex deletes an unselected on-demand
  // download), and sub-add it into the running mpv instance. No reload —
  // playback continues uninterrupted.
  const refreshSubtitlesAfterDownload = useCallback(async () => {
    if (!server) return;
    const prevIds = subtitleTracksRef.current.map((t) => t.id);
    const result = await waitForDownloadedSubtitle(
      server.uri,
      server.accessToken,
      ratingKey,
      partIdRef.current,
      prevIds,
    );
    if (!result) return;
    // Sync the ref immediately — selectSubtitleTrack below resolves the
    // stream's `key` through it before the state update lands.
    subtitleTracksRef.current = result.tracks;
    setSubtitleTracks(result.tracks);
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
    selectSubtitleTrack(result.added.id);
  }, [server, ratingKey, selectSubtitleTrack]);

  // ── Public dispatch methods ──────────────────────────────────────────────

  // Idempotent pause — invoked by usePostPlay when the overlay opens so audio
  // doesn't leak under the post-play screen. mpv treats "set pause=true on
  // already-paused" as a no-op.
  const pause = useCallback(() => {
    logger.debug("player", "pause (public)");
    invoke("player_pause").catch((err) =>
      logger.warn("player", "pause failed", String(err)),
    );
  }, []);

  // Public unload — exposes the existing player_unload command so
  // usePlayerLifecycle.exit can drive teardown without invoking directly.
  // The unmount-time cleanup useEffect still issues its own unload; calling
  // this BEFORE unmount ensures audio is silenced synchronously. player_unload
  // is idempotent at the Rust layer (destroy() guards on the optional handle).
  const unload = useCallback(async () => {
    logger.info("player", "unload (public)");
    await invoke("player_unload");
  }, []);

  // Public EOF subscription. The internal listener handles bookkeeping
  // (timeline report, watch-sync); this set is for consumer-side reactions
  // (e.g. usePostPlay deciding whether to open the overlay). Returns a
  // stable unsubscribe.
  const subscribeToEof = useCallback((handler: () => void) => {
    eofSubscribersRef.current.add(handler);
    return () => {
      eofSubscribersRef.current.delete(handler);
    };
  }, []);

  // Cache the latest sub-style request and apply it now if mpv is ready;
  // otherwise the ready listener above will flush pendingSubStyleRef.
  const applySubtitleStyle = useCallback(
    ({ size, style }: { size: number; style: SubtitleStylePreferences }) => {
      pendingSubStyleRef.current = { size, style };
      if (!isReadyRef.current) {
        logger.debug("player", "applySubtitleStyle deferred (mpv not ready)");
        return;
      }
      const payload = {
        size,
        fontFamily: style.fontFamily,
        textColor: style.textColor,
        backgroundColor: style.backgroundColor,
        backgroundOpacity: style.backgroundOpacity,
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
        shadowEnabled: style.shadowEnabled,
      };
      logger.info("player", "player_apply_sub_style", payload);
      invoke("player_apply_sub_style", { style: payload }).catch((err) =>
        logger.error("player", "player_apply_sub_style failed", String(err)),
      );
    },
    [],
  );

  // Audio enhancement IPC bridge. Before mpv is ready we buffer the desired
  // state in pendingAfRef so the ready handler can flush it (covers cold
  // start where persisted prefs need to be applied once). After ready we
  // hit the IPCs directly so user-driven changes are immediate.
  const applyAudioEnhancement = useCallback(
    (changes: {
      normalizationPreset?: NormalizationPreset;
      audioOffsetMs?: number;
    }) => {
      // Merge the latest fields into the pending bag so a later ready
      // flush sees the full state, even if changes arrived as separate
      // partial calls.
      pendingAfRef.current = {
        ...(pendingAfRef.current ?? {}),
        ...changes,
      };
      if (!isReadyRef.current) {
        logger.debug("player", "applyAudioEnhancement deferred (mpv not ready)", changes);
        return;
      }
      if (changes.normalizationPreset !== undefined) {
        logger.info("player", "player_set_af_chain", {
          preset: changes.normalizationPreset,
        });
        invoke("player_set_af_chain", { preset: changes.normalizationPreset }).catch(
          (err) => logger.error("player", "player_set_af_chain failed", String(err)),
        );
      }
      if (changes.audioOffsetMs !== undefined) {
        logger.info("player", "player_set_audio_delay_ms", {
          ms: changes.audioOffsetMs,
        });
        invoke("player_set_audio_delay_ms", { ms: changes.audioOffsetMs }).catch(
          (err) => logger.error("player", "player_set_audio_delay_ms failed", String(err)),
        );
      }
    },
    [],
  );

  return useMemo<UsePlayerResult>(
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
      refreshSubtitlesAfterDownload,
      pause,
      unload,
      setFullscreen,
      subscribeToEof,
      applySubtitleStyle,
      applyAudioEnhancement,
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
      refreshSubtitlesAfterDownload,
      pause,
      unload,
      setFullscreen,
      subscribeToEof,
      applySubtitleStyle,
      applyAudioEnhancement,
    ],
  );
}
