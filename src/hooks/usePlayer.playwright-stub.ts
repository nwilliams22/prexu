/**
 * Playwright player-chrome test-mode stub for the playback engine.
 *
 * Resolved ONLY via the Vite alias in vite.config.ts, active ONLY under the
 * dedicated "player-chrome-test" mode (see PLAYER_CHROME_TEST_MODE there).
 * It is never referenced by any import statement in the app itself — the
 * alias is a build-time swap of `../hooks/usePlayer`, not a runtime branch —
 * so it cannot be reached from `npm run dev` or `npm run build`. The throw
 * below is a second, independent guard against the file ever being loaded
 * outside that mode (e.g. a future direct import, or a mode-name typo in
 * the alias config).
 *
 * Purpose (prexu-ceiz, spike prexu-pd1x.12): let e2e/player-chrome.spec.ts
 * drive the REAL player chrome — ControlsBottomBar, ControlsOverflowMenu,
 * SeekBar, ErrorOverlay, KeyboardShortcutsOverlay (all plain React,
 * unit-tested elsewhere) — on /play/<ratingKey> in a real browser, with NO
 * native player and NO real Plex stream. It implements the exact
 * `UsePlayerResult` contract the real src/hooks/usePlayer.ts produces (see
 * that file's docblock: "Both backends return the same UsePlayerResult so
 * PlayerControls, watch-together hooks, and the post-play screen don't care
 * which is active" — this stub is a third such backend, test-only) but
 * everything is in-memory state: no network, no hls.js, no <video> src.
 *
 * Scriptability: rather than threading test hooks through props (which
 * would touch production chrome components), this stub exposes a small
 * imperative harness on `window.__playerChromeStub__` for the ONE mount
 * that's currently active. Playwright specs call it via `page.evaluate()`
 * to force states that aren't reachable through ordinary UI interaction
 * within the timebox (e.g. a playback error, for ErrorOverlay coverage).
 * Play/pause/seek/volume/etc. are driven through the real chrome's buttons
 * and callbacks — no harness needed for those, exactly like the real thing.
 *
 * Deliberately NOT implemented (documented as deferred in the PR):
 *   - Native engine dispatch — unreachable here by construction: engine
 *     resolution (engineResolution.ts) always picks "html5" when
 *     `window.__TAURI_INTERNALS__` is absent, and this project must never
 *     set that (the 48-fake-pass trap — see e2e/mock-tauri.ts). So this
 *     stub only ever needs to satisfy the HTML5-shaped contract.
 *   - MiniChrome / in-window minimize — gated on SUPPORTS_PLAYER_MINIMIZE,
 *     which itself requires IS_NATIVE_PLAYER_PLATFORM (Tauri) and is
 *     therefore unreachable for the same reason.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlexChapter, PlexMarker, PlexStream } from "../types/library";
import type {
  NormalizationPreset,
  SubtitleStylePreferences,
} from "../types/preferences";
import { logger } from "../services/logger";

/** Grep target for the CI "verify stub absent from production bundle" step
 *  (see .github/workflows/ci.yml, linux-build job) — proves mechanically
 *  that this file never lands in a `npm run build` artifact. Also guards
 *  the mode-check below so both the throw message and the bundle-scan use
 *  the exact same literal. */
export const PLAYER_CHROME_STUB_MARKER = "PLAYER_CHROME_TEST_STUB_v1";

const PLAYER_CHROME_TEST_MODE = "player-chrome-test";

if (import.meta.env.MODE !== PLAYER_CHROME_TEST_MODE) {
  throw new Error(
    `[${PLAYER_CHROME_STUB_MARKER}] usePlayer.playwright-stub.ts must only be ` +
      `resolved via the player-chrome-test Vite alias (see vite.config.ts) — ` +
      `current mode is "${import.meta.env.MODE}"`,
  );
}

logger.info(
  "player",
  `[${PLAYER_CHROME_STUB_MARKER}] player-chrome test-mode stub engine active`,
);

// ── Test harness ────────────────────────────────────────────────────────
// One active Player mount at a time in the player-chrome Playwright
// project — a single module-level slot is sufficient and keeps the harness
// trivial. Re-registered on every mount; cleared on unmount so a stale
// harness never lingers after the player closes.
export interface PlayerChromeStubHarness {
  /** Force a playback error (ErrorOverlay) — pass null to clear it. */
  setError: (message: string | null) => void;
  /** Force the loading state (loading overlay / spinner). */
  setLoading: (loading: boolean) => void;
  /** Override the fixed fixture duration (seconds). */
  setDuration: (seconds: number) => void;
  /** Jump the playhead directly (seconds), bypassing the seek bar UI. */
  setCurrentTime: (seconds: number) => void;
  /** Fire the same completion callback the real backends dispatch on
   *  <video> "ended" / mpv player://eof — exercises useSkipSegments /
   *  usePostPlay's EOF path without waiting for the fixture clock. */
  triggerEof: () => void;
  /** Snapshot of the current in-memory state, for assertions that don't
   *  want to depend on a specific DOM affordance. */
  getState: () => {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    isLoading: boolean;
    playbackError: string | null;
  };
}

declare global {
  interface Window {
    __playerChromeStub__?: PlayerChromeStubHarness;
  }
}

/** Fixture duration for the stub session — arbitrary but fixed so seek-bar
 *  percentage math and the "-mm:ss remaining" label are deterministic. */
const FIXTURE_DURATION_SECONDS = 600;

/** Fixture playhead advance while "playing" — accelerated (not wall-clock
 *  real-time) so a play-then-seek test doesn't need to wait a full 10
 *  minutes; purely cosmetic, no spec in this PR depends on it ticking. */
const FIXTURE_TICK_INTERVAL_MS = 250;
const FIXTURE_TICK_STEP_SECONDS = 2;

// Re-declare the same result shape the real hook exports, duplicated here
// (rather than imported) so this stub has zero import-time dependency on
// ../hooks/usePlayer — keeping the swapped seam exactly as narrow as the
// Vite alias itself. Structurally identical to `UsePlayerResult` /
// `PlayerChrome` there; see that file for field-by-field docs.
export type ResolvedEngine = "native" | "html5";

export interface PlayerChrome {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  title: string;
  subtitle: string;
  isLoading: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  duration: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  playbackError: string | null;
  chapters: PlexChapter[];
  markers: PlexMarker[];
  itemType: string;
  parentRatingKey: string;
  audioTracks: PlexStream[];
  subtitleTracks: PlexStream[];
  selectedAudioId: number | null;
  selectedSubtitleId: number | null;
  togglePlay: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  selectAudioTrack: (streamId: number) => void;
  selectSubtitleTrack: (streamId: number | null) => void;
  retry: () => void;
  refreshSubtitlesAfterDownload: () => Promise<void>;
  pause: () => void;
  unload: () => Promise<void>;
  setFullscreen: (fullscreen: boolean) => Promise<void>;
  subscribeToEof: (handler: () => void) => () => void;
  applySubtitleStyle: (args: { size: number; style: SubtitleStylePreferences }) => void;
  applyAudioEnhancement: (changes: {
    normalizationPreset?: NormalizationPreset;
    audioOffsetMs?: number;
  }) => void;
  engine: ResolvedEngine;
}

export interface UsePlayerResult extends PlayerChrome {
  currentTime: number;
  buffered: number;
  chrome: PlayerChrome;
}

export function usePlayer(ratingKey: string, _offsetOverride?: number | null): UsePlayerResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(FIXTURE_DURATION_SECONDS);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(null);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<number | null>(null);

  const eofHandlersRef = useRef(new Set<() => void>());

  logger.debug("player", `[${PLAYER_CHROME_STUB_MARKER}] usePlayer stub mount`, { ratingKey });

  // ── Fixture playhead ticking while "playing" ──
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setCurrentTime((t) => {
        const next = t + FIXTURE_TICK_STEP_SECONDS;
        if (next >= duration) {
          window.clearInterval(id);
          setIsPlaying(false);
          for (const handler of eofHandlersRef.current) handler();
          return duration;
        }
        return next;
      });
    }, FIXTURE_TICK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isPlaying, duration]);

  // ── Fullscreen listener (real DOM API — nothing engine-specific) ──
  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  const seek = useCallback(
    (time: number) => {
      setCurrentTime(Math.max(0, Math.min(time, duration)));
    },
    [duration],
  );

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(2, vol));
    setVolumeState(clamped);
    if (clamped > 0) setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => setIsMuted((m) => !m), []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  const setFullscreen = useCallback(async (fullscreen: boolean) => {
    if (fullscreen) {
      await document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
  }, []);

  const selectAudioTrack = useCallback((streamId: number) => {
    setSelectedAudioId(streamId);
  }, []);

  const selectSubtitleTrack = useCallback((streamId: number | null) => {
    setSelectedSubtitleId(streamId);
  }, []);

  const retry = useCallback(() => {
    setPlaybackError(null);
    setIsLoading(false);
  }, []);

  const refreshSubtitlesAfterDownload = useCallback(async () => {
    logger.debug("player", "stub refreshSubtitlesAfterDownload (no-op)");
  }, []);

  const pause = useCallback(() => setIsPlaying(false), []);

  const unload = useCallback(async () => {
    logger.debug("player", "stub unload (no-op)");
  }, []);

  const subscribeToEof = useCallback((handler: () => void) => {
    eofHandlersRef.current.add(handler);
    return () => {
      eofHandlersRef.current.delete(handler);
    };
  }, []);

  const applySubtitleStyle = useCallback(
    (_args: { size: number; style: SubtitleStylePreferences }) => {
      // no-op — the real HTML5 backend maintains a <style> tag here; the
      // stub has no subtitle rendering surface to style.
    },
    [],
  );

  const applyAudioEnhancement = useCallback(
    (_changes: { normalizationPreset?: NormalizationPreset; audioOffsetMs?: number }) => {
      // no-op — matches the real HTML5 backend (Web Audio graph owns this).
    },
    [],
  );

  // ── Test harness registration ──
  useEffect(() => {
    const harness: PlayerChromeStubHarness = {
      setError: (message) => setPlaybackError(message),
      setLoading: (loading) => setIsLoading(loading),
      setDuration: (seconds) => setDuration(seconds),
      setCurrentTime: (seconds) => setCurrentTime(Math.max(0, Math.min(seconds, duration))),
      triggerEof: () => {
        for (const handler of eofHandlersRef.current) handler();
      },
      getState: () => ({
        isPlaying,
        currentTime,
        duration,
        isLoading,
        playbackError,
      }),
    };
    window.__playerChromeStub__ = harness;
    logger.debug("player", `[${PLAYER_CHROME_STUB_MARKER}] harness registered on window`);
    return () => {
      delete window.__playerChromeStub__;
    };
    // Re-registered whenever any snapshot-relevant value changes so
    // getState() never returns stale data.
  }, [isPlaying, currentTime, duration, isLoading, playbackError]);

  const chrome = useMemo<PlayerChrome>(
    () => ({
      videoRef,
      title: `Stub Item ${ratingKey}`,
      subtitle: "",
      isLoading,
      isPlaying,
      isBuffering: false,
      duration,
      volume,
      isMuted,
      isFullscreen,
      playbackError,
      chapters: [],
      markers: [],
      itemType: "movie",
      parentRatingKey: "",
      audioTracks: [],
      subtitleTracks: [],
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
      engine: "html5",
    }),
    [
      ratingKey,
      isLoading,
      isPlaying,
      duration,
      volume,
      isMuted,
      isFullscreen,
      playbackError,
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
    () => ({ ...chrome, currentTime, buffered: 0, chrome }),
    [chrome, currentTime],
  );
}
