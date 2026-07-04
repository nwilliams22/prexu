/**
 * Native (libmpv-backed) playback hook — Windows and Linux (prexu-axj4).
 *
 * Replaces the HTML5 `<video>` + hls.js bindings with Tauri commands +
 * `player://*` event subscriptions. Returns the same `UsePlayerResult` shape
 * as `usePlayer` so PlayerControls, watch-together hooks, and the post-play
 * screen compile unchanged.
 *
 * Only reached when usePlayer() has already resolved the engine to
 * "native" for this mount (see engineResolution.ts) — this hook doesn't
 * re-check platform/preference, but it DOES do a one-time runtime
 * pre-flight (`player_engine_status`) and listens for a later runtime
 * failure (`player://engine-failed`); both paths set the session-fallback
 * flag so PlayerOverlay force-remounts into HTML5 (prexu-axj4.4).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAuth } from "../useAuth";
import { usePreferences } from "../usePreferences";
import { useTimelineReporting } from "./useTimelineReporting";
import {
  IS_LINUX_NATIVE_PLAYER,
  setPendingResumeOffsetMs,
  setSessionFallbackActive,
} from "./engineResolution";
import { HOST_READY_FALLBACK_MS } from "./useTransparentWindow";
import { addPendingWatchSync, getClientIdentifier } from "../../services/storage";
import {
  prepareSource,
  applyPreparedMetadata,
  refreshDownloadedSubtitles,
  reportTimeline,
  getSavedVolume,
  saveVolume,
} from "../../services/plex-playback";
import type {
  PlexStream,
  PlexChapter,
  PlexMarker,
} from "../../types/library";
import type {
  NormalizationPreset,
  SubtitleStylePreferences,
} from "../../types/preferences";
import type { PlayerChrome, UsePlayerResult } from "../usePlayer";
import { logger, redactUrl } from "../../services/logger";

/** Shape of the player_engine_status IPC response (prexu-axj4.4 contract). */
interface PlayerEngineStatus {
  available: boolean;
  reason: string | null;
}

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
  // Mute is deliberately PER-SESSION, unlike volume (design decision,
  // prexu-jphh / bd memory player-mute-scope-decision): it carries across
  // episode handoff/autoplay within this mount (via isMutedRef), but a stop
  // unmounts the hook and the next session starts unmuted. Do NOT persist
  // this to localStorage — PR #38 tried and was reverted.
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
  // Monotonic init generation. Each initPlayback claims the next value and
  // every async continuation checks it still owns the current generation
  // before touching mpv or React state; the per-ratingKey cleanup bumps it
  // so a superseded init stops at its next checkpoint.
  const initGenRef = useRef(0);
  // Guards the one-time player_engine_status pre-flight check (below) so
  // it only runs on the true first init of this mount, not on every
  // episode handoff's initPlayback re-run.
  const engineStatusCheckedRef = useRef(false);
  const isLocalPlaybackRef = useRef(false);
  // Media part id of the currently playing file — needed to persist subtitle
  // selection on the server after an on-demand download.
  const partIdRef = useRef<number | undefined>(undefined);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const offsetOverrideRef = useRef(offsetOverride);
  offsetOverrideRef.current = offsetOverride;

  // ── Linux-only reveal-mute workaround (prexu-axj4.5) ──
  // On Linux native, mpv's audio for a newly-loaded file starts slightly
  // before the first composited frame reaches the WebView (~1s), so audio
  // is briefly audible under the opaque loading screen before the video
  // reveals. Windows does not exhibit this (user-confirmed), so the whole
  // workaround is scoped to IS_LINUX_NATIVE_PLAYER and is a no-op
  // everywhere else — see initPlayback below for the arm/restore sequence.
  //
  // revealMuteArmedRef is the gate `applyMuted` consults: while armed, ANY
  // player_set_muted invoke (user toggle, saved-preference apply after
  // load) is deferred rather than sent to mpv immediately, so a mid-load
  // mute/unmute toggle can't sneak audio past the workaround. The LATEST
  // user intent (isMutedRef.current) is applied in one shot once armed
  // clears.
  const revealMuteArmedRef = useRef(false);
  // Unlisten for the per-load player://host-window-ready subscription that
  // clears the arm. Tracked so a superseded/unmounted load's listener is
  // always torn down (never fires after teardown, never leaks).
  const revealMuteUnlistenRef = useRef<UnlistenFn | undefined>(undefined);
  // Safety-net mirroring useTransparentWindow's HOST_READY_FALLBACK_MS: if
  // host-window-ready never arrives for some reason, restore mute anyway
  // rather than leaving audio permanently silenced for the rest of the load.
  const revealMuteTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Tear down any pending reveal-mute wait (listener + fallback timer) and
   *  clear the arm gate. Called at the start of every initPlayback (fresh
   *  load supersedes any prior pending wait) and from both cleanup effects
   *  so a superseded or unmounted load never restores/leaks. */
  const teardownRevealMute = useCallback(() => {
    revealMuteUnlistenRef.current?.();
    revealMuteUnlistenRef.current = undefined;
    if (revealMuteTimeoutRef.current !== undefined) {
      clearTimeout(revealMuteTimeoutRef.current);
      revealMuteTimeoutRef.current = undefined;
    }
    revealMuteArmedRef.current = false;
  }, []);

  /** Single funnel for every player_set_muted invoke (initial saved-state
   *  apply after load, toggleMute, setVolume's auto-unmute). While the
   *  reveal-mute workaround is armed, the invoke is deferred — the actual
   *  mpv-side mute stays forced-true until the arm clears — everywhere else
   *  (Windows, HTML5, or once the arm has cleared) this is a plain
   *  pass-through invoke, so behavior is unchanged there. */
  const applyMuted = useCallback(async (muted: boolean) => {
    if (revealMuteArmedRef.current) {
      logger.debug("player", "reveal-mute armed — deferring player_set_muted", { muted });
      return;
    }
    logger.debug("player", "player_set_muted", { muted });
    try {
      await invoke("player_set_muted", { muted });
    } catch (err) {
      logger.error("player", "player_set_muted failed", String(err));
    }
  }, []);

  // ── Deferred-op queue ──
  // Replaces three separate pending refs (pendingExternalSubRef,
  // pendingSubStyleRef, pendingAfRef). Any op that needs mpv to be ready
  // calls enqueueOrRun(fn): if mpv is ready the op fires immediately,
  // otherwise it is appended to the queue and replayed in insertion order
  // when player://ready fires. For ops that must replace a prior pending
  // version (sub-style, af-chain) the caller dequeues the old entry first
  // via dequeueByTag before enqueuing the new one — this is handled inside
  // applySubtitleStyle / applyAudioEnhancement below.
  const isReadyRef = useRef(false);
  const deferredOpsRef = useRef<Array<{ tag: string; fn: () => void }>>([]);

  const enqueueOrRun = useCallback((tag: string, fn: () => void) => {
    if (isReadyRef.current) {
      fn();
    } else {
      deferredOpsRef.current.push({ tag, fn });
    }
  }, []);

  const dequeueByTag = useCallback((tag: string) => {
    deferredOpsRef.current = deferredOpsRef.current.filter((op) => op.tag !== tag);
  }, []);

  const flushOnReady = useCallback(() => {
    const ops = deferredOpsRef.current.splice(0);
    for (const op of ops) {
      try {
        op.fn();
      } catch (err) {
        logger.error("player", `ready-flush op [${op.tag}] threw`, String(err));
      }
    }
  }, []);

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
          // Replay all deferred ops in insertion order. The ops themselves
          // contain the logging and invoke calls that were previously inlined
          // here (external sub, sub-style, af-chain). Ordering is preserved
          // because enqueueOrRun appends in call order.
          flushOnReady();
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
        // Runtime native failure (render/GL init failed after mpv was
        // already committed to — see docs/adr-native-player-render-api.md
        // and prexu-axj4.4). Stashes the last known position (best-effort
        // resume-offset preservation) then sets the session-fallback flag;
        // PlayerOverlay subscribes to it and force-remounts <Player> into
        // HTML5, consuming the stashed offset for the new session.
        listen<string>("player://engine-failed", (e) => {
          logger.warn("player", "native engine failed at runtime — falling back to HTML5", e.payload);
          setPendingResumeOffsetMs(Math.round(timeline.currentTimeRef.current * 1000));
          setSessionFallbackActive(true);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- timeline refs and flushOnReady are stable
  }, [server, flushOnReady]);

  // ── Initialize playback ──
  const initPlayback = useCallback(async () => {
    const gen = ++initGenRef.current;
    logger.info("player", "initPlayback", { ratingKey, gen });
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

    // One-time engine-resolution pre-flight (prexu-axj4.4): usePlayer()
    // already committed to "native" for this mount before mpv init was
    // ever attempted (rules-of-hooks — see engineResolution.ts), so this
    // can't block that decision. Instead it double-checks the Rust side
    // is actually ready RIGHT before the first load_url and bails into
    // the fallback path if not, rather than proceeding to a native init
    // that's doomed to fail. Guarded to run once per mount, not per
    // episode handoff. A malformed/undefined response (e.g. the command
    // not yet returning the documented shape) is treated as available —
    // only an explicit `available:false` or an invoke rejection triggers
    // fallback, matching the IPC contract in the axj4.4 bead notes.
    if (!engineStatusCheckedRef.current) {
      engineStatusCheckedRef.current = true;
      try {
        const status = await invoke<PlayerEngineStatus>("player_engine_status");
        if (gen !== initGenRef.current) {
          logger.debug("player", "initPlayback superseded", { gen });
          return;
        }
        if (status && status.available === false) {
          logger.warn(
            "player",
            "player_engine_status reported unavailable — falling back to HTML5",
            status.reason ?? "no reason given",
          );
          setSessionFallbackActive(true);
          return;
        }
      } catch (err) {
        if (gen !== initGenRef.current) {
          logger.debug("player", "initPlayback superseded", { gen });
          return;
        }
        logger.warn("player", "player_engine_status invoke failed — falling back to HTML5", String(err));
        setSessionFallbackActive(true);
        return;
      }
    }

    try {
      const prepared = await prepareSource({
        server,
        ratingKey,
        preferences: prefsRef.current.playback,
        offsetOverride: offsetOverrideRef.current,
        directPlayFailed: directPlayFailedRef.current,
        skipCodecCheck: true,
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
        setAudioTracks,
        setSubtitleTracks: (tracks) => {
          // Sync the ref immediately so selectSubtitleTrack can resolve the
          // external sub `key` before the state update lands.
          subtitleTracksRef.current = tracks;
          setSubtitleTracks(tracks);
        },
        setSelectedAudioId,
        setSelectedSubtitleId,
        setIsLocalPlayback: (v) => { isLocalPlaybackRef.current = v; },
        setPartId: (v) => { partIdRef.current = v; },
      });

      // Register the Rust-side close report context (prexu-50f): if the
      // window closes mid-playback the JS cleanup can't run, so Rust fires
      // the final stopped timeline report using mpv's live position.
      void (async () => {
        try {
          const clientId = await getClientIdentifier();
          if (gen !== initGenRef.current) {
            logger.debug("player", "initPlayback superseded", { gen });
            return;
          }
          await invoke("player_set_timeline_context", {
            ctx: {
              serverUri: server.uri,
              token: server.accessToken,
              ratingKey,
              durationMs: prepared.playable.duration ?? 0,
              clientId,
            },
          });
        } catch (err) {
          logger.warn("player", "set_timeline_context failed", String(err));
        }
      })();

      logger.debug("player", "URL chosen", { kind: prepared.sourceKind, url: redactUrl(prepared.url) });

      // load_url runs ensure_init server-side which actually creates the
      // mpv handle. Volume/mute commands assume an initialised handle, so
      // they MUST come after load_url, not before.
      logger.info("player", "loading URL", { url: redactUrl(prepared.url), startOffsetMs: prepared.viewOffset });
      // Buffer the external default sub BEFORE loadfile: the ready event can
      // fire before the post-load_url code below runs (fast reloads). Use
      // enqueueOrRun so it runs via the ready flush with preserved ordering.
      dequeueByTag("external-sub");
      if (prepared.defaultSub?.key) {
        const externalSubUrl = `${server.uri}${prepared.defaultSub.key}?X-Plex-Token=${server.accessToken}`;
        enqueueOrRun("external-sub", () => {
          logger.info("player", "ready-flush player_load_external_sub", {
            url: redactUrl(externalSubUrl),
          });
          invoke("player_load_external_sub", { url: externalSubUrl }).catch((err) =>
            logger.error("player", "ready-flush player_load_external_sub failed", String(err)),
          );
        });
      }

      // Reset from any prior (superseded) load's reveal-mute wait before
      // arming a fresh one for THIS load — see the refs/applyMuted docblock
      // above. Linux-only; a plain no-op on every other platform.
      teardownRevealMute();
      if (IS_LINUX_NATIVE_PLAYER) {
        revealMuteArmedRef.current = true;
        logger.debug("player", "reveal-mute arming for load", { gen });
        // Belt-and-braces early arm. The AUTHORITATIVE arm is Rust-side:
        // player_load_url mutes mpv (Linux-gated) right after ensure_init,
        // before loadfile — the only point that also covers the cold first
        // load of a session, where this invoke rejects with "mpv not
        // initialised" (caught and logged, never blocks the load) because
        // mpv doesn't exist until player_load_url runs. On warm loads
        // (episode handoff keeps the handle alive via soft-stop) this
        // lands slightly earlier than the Rust arm.
        invoke("player_set_muted", { muted: true }).catch((err) =>
          logger.warn("player", "reveal-mute arm invoke failed", String(err)),
        );

        let settled = false;
        const settleRevealMute = (reason: "event" | "timeout" | "listen-failed") => {
          if (settled) return;
          settled = true;
          if (gen !== initGenRef.current) {
            logger.debug("player", "reveal-mute restore skipped — superseded load", {
              gen,
              reason,
            });
            return;
          }
          if (revealMuteTimeoutRef.current !== undefined) {
            clearTimeout(revealMuteTimeoutRef.current);
            revealMuteTimeoutRef.current = undefined;
          }
          revealMuteUnlistenRef.current = undefined;
          revealMuteArmedRef.current = false;
          logger.debug("player", "reveal-mute restoring user muted state", {
            muted: isMutedRef.current,
            reason,
          });
          void applyMuted(isMutedRef.current);
        };

        // Safety net: restore anyway if host-window-ready never arrives,
        // mirroring useTransparentWindow's HOST_READY_FALLBACK_MS so audio
        // is never left permanently silenced for the rest of the load.
        revealMuteTimeoutRef.current = setTimeout(
          () => settleRevealMute("timeout"),
          HOST_READY_FALLBACK_MS,
        );

        try {
          const unlisten = await listen<null>("player://host-window-ready", () => {
            settleRevealMute("event");
          });
          if (gen !== initGenRef.current || settled) {
            // Superseded (or already settled via the fallback timeout)
            // while awaiting listener registration — don't leave a
            // dangling subscription behind.
            unlisten();
          } else {
            revealMuteUnlistenRef.current = unlisten;
          }
        } catch (err) {
          logger.warn("player", "reveal-mute listen(host-window-ready) failed", String(err));
          settleRevealMute("listen-failed");
        }
      }

      await invoke("player_load_url", {
        url: prepared.url,
        headers: {} as Record<string, string>,
        startOffsetMs: prepared.viewOffset,
      });
      if (gen !== initGenRef.current) {
        logger.debug("player", "initPlayback superseded", { gen });
        return;
      }
      logger.info("player", "load_url returned OK, waiting for ready event");

      // Apply saved volume + mute now that mpv exists. mpv volume is 0..200
      // (we configured volume-max=200 in PlayerState::ensure_init); our
      // `volume` state is 0..2 in float.
      await invoke("player_set_volume", {
        vol: Math.max(0, Math.min(200, Math.round(volumeRef.current * 100))),
      });
      if (gen !== initGenRef.current) {
        logger.debug("player", "initPlayback superseded", { gen });
        return;
      }
      // Routed through applyMuted (not a raw invoke) so this is deferred
      // while the reveal-mute workaround is armed (Linux) instead of
      // immediately un-forcing mute right after load — see applyMuted's
      // docblock above.
      await applyMuted(isMutedRef.current);
      if (gen !== initGenRef.current) {
        logger.debug("player", "initPlayback superseded", { gen });
        return;
      }

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
          if (gen !== initGenRef.current) {
            logger.debug("player", "initPlayback superseded", { gen });
            return;
          }
        }
      }
      if (defaultSub) {
        if (defaultSub.key) {
          // External default sub: enqueued above (before loadfile) via
          // enqueueOrRun("external-sub") — sub-add fails with
          // MPV_ERROR_COMMAND before the file is loaded; the op runs on ready.
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
      if (gen !== initGenRef.current) {
        logger.debug("player", "initPlayback superseded", { gen });
        return;
      }

      timeline.startTimeline();
      // setIsLoading(false) happens when `player://ready` fires.
    } catch (err) {
      if (gen !== initGenRef.current) {
        logger.debug("player", "initPlayback superseded", { gen });
        return;
      }
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
  }, [server, ratingKey, timeline, teardownRevealMute, applyMuted]);

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
      initGenRef.current++;
      logger.info("player", "cleanup: stopping timeline + soft-stop mpv");
      timeline.stopTimeline();
      timeline.reportStopped();
      // JS just sent the stopped report — clear the Rust-side close report
      // context so a later window close doesn't replay a stale position.
      // The next initPlayback (episode handoff) registers a fresh one.
      invoke("player_clear_timeline_context").catch(() => {});
      invoke("player_stop").catch((err) =>
        logger.error("player", "player_stop failed", String(err)),
      );
      // Tear down any still-pending reveal-mute wait (Linux-only,
      // prexu-axj4.5) — covers both episode-handoff (a fresh arm follows
      // in the next initPlayback) and true unmount (this effect's cleanup
      // also runs then, so no dangling listener/timer survives teardown).
      teardownRevealMute();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- timeline funcs are stable
  }, [initPlayback]);

  // Declared here so the true-unmount effect below can close over it.
  // Refs are stable (same object throughout the component lifetime) so
  // moving the declaration above the effect that reads it is always safe.
  const isFullscreenRef = useRef(isFullscreen);
  isFullscreenRef.current = isFullscreen;

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
  // isPlaying is read through a ref so togglePlay keeps a stable identity
  // across play/pause transitions — it sits in the tick-stable chrome
  // slice and feeds long-lived consumers (keyboard handler, WT sync).
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const togglePlay = useCallback(() => {
    const playing = isPlayingRef.current;
    logger.debug("player", playing ? "pause" : "play");
    invoke(playing ? "player_pause" : "player_play").catch(() => {});
  }, []);

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
        // Routed through applyMuted so a volume-driven auto-unmute can't
        // sneak past the Linux reveal-mute workaround mid-load either.
        void applyMuted(false);
      }
    },
    [applyMuted],
  );

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    setIsMuted(next);
    // Routed through applyMuted: React state (and so the mute button icon)
    // flips immediately, but the actual mpv-side invoke is deferred while
    // the Linux reveal-mute workaround is armed — the LATEST toggle here
    // still wins once the arm clears (see applyMuted's docblock).
    void applyMuted(next);
  }, [applyMuted]);

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
        url: redactUrl(url),
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
    await refreshDownloadedSubtitles({
      server,
      ratingKey,
      partIdRef,
      initGenRef,
      prevSubIds: subtitleTracksRef.current.map((t) => t.id),
      // Sync the ref immediately — selectSubtitleTrack resolves the stream's
      // `key` through it before the state update lands.
      onTracksUpdated: (tracks) => {
        subtitleTracksRef.current = tracks;
        setSubtitleTracks(tracks);
      },
      // Native path: fire-and-forget (sync mpv invoke inside selectSubtitleTrack).
      onSelectSubtitle: (id) => { selectSubtitleTrack(id); },
    });
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

  // Enqueue the latest sub-style request, replacing any prior pending version.
  // If mpv is already ready the op fires immediately via enqueueOrRun.
  const applySubtitleStyle = useCallback(
    ({ size, style }: { size: number; style: SubtitleStylePreferences }) => {
      // Replace any previously queued style — only the latest matters.
      dequeueByTag("sub-style");
      if (!isReadyRef.current) {
        logger.debug("player", "applySubtitleStyle deferred (mpv not ready)");
      }
      enqueueOrRun("sub-style", () => {
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
      });
    },
    [enqueueOrRun, dequeueByTag],
  );

  // Audio enhancement IPC bridge. Each field is enqueued independently so
  // partial updates (e.g. only audioOffsetMs) don't discard a prior pending
  // normalizationPreset that hasn't flushed yet. If mpv is already ready
  // enqueueOrRun fires each op immediately.
  const applyAudioEnhancement = useCallback(
    (changes: {
      normalizationPreset?: NormalizationPreset;
      audioOffsetMs?: number;
    }) => {
      if (!isReadyRef.current) {
        logger.debug("player", "applyAudioEnhancement deferred (mpv not ready)", changes);
      }
      if (changes.normalizationPreset !== undefined) {
        const preset = changes.normalizationPreset;
        // Replace any pending normalization — only the latest preset matters.
        dequeueByTag("af-chain");
        enqueueOrRun("af-chain", () => {
          logger.info("player", "player_set_af_chain", { preset });
          invoke("player_set_af_chain", { preset }).catch(
            (err) => logger.error("player", "player_set_af_chain failed", String(err)),
          );
        });
      }
      if (changes.audioOffsetMs !== undefined) {
        const ms = changes.audioOffsetMs;
        // Replace any pending audio delay — only the latest value matters.
        dequeueByTag("audio-delay");
        enqueueOrRun("audio-delay", () => {
          logger.info("player", "player_set_audio_delay_ms", { ms });
          invoke("player_set_audio_delay_ms", { ms }).catch(
            (err) => logger.error("player", "player_set_audio_delay_ms failed", String(err)),
          );
        });
      }
    },
    [enqueueOrRun, dequeueByTag],
  );

  // Tick-stable slice: memoized over stable callbacks + rarely-changing
  // state only. currentTime/buffered are deliberately excluded so chrome
  // consumers (transport buttons, menus, effects) don't churn at the
  // Rust-throttled 4 Hz time-pos rate.
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
      engine: "native",
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

  return useMemo<UsePlayerResult>(
    () => ({ ...chrome, currentTime, buffered, chrome }),
    [chrome, currentTime, buffered],
  );
}
