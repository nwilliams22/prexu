/**
 * Tests for useNativePlayer's public dispatch surface (prexu-ve9).
 *
 * Scope: the new UsePlayerResult contract methods that route consumers
 * through `player.*` instead of branching on IS_NATIVE_PLAYER —
 * subscribeToEof, applySubtitleStyle, applyAudioEnhancement.
 *
 * The hook composes useAuth + usePreferences + useTimelineReporting and
 * subscribes to a dozen `player://*` events, so we don't try to render
 * the whole thing here. Instead we drive the parts under test in
 * isolation by reading the captured `player://*` listeners from the
 * Tauri event mock and firing payloads at them. This is the same shape
 * usePostPlay.test.ts uses, just with the bookkeeping listener target
 * (useNativePlayer itself) instead of usePostPlay.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────
// Mock Tauri invoke + event before any imports trigger transitive resolution.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/logger")>()),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

// useAuth + usePreferences supply server + prefs — stub with deterministic
// shapes. Server is required so the EOF reportTimeline branch doesn't
// crash; tests don't assert on the timeline calls directly. The server and
// timeline objects must be render-stable singletons: initPlayback lists
// them as useCallback deps, and a fresh identity per render would re-fire
// the init effect on every state update.
const { serverMock, timelineMock } = vi.hoisted(() => ({
  serverMock: { uri: "https://server", accessToken: "token" },
  timelineMock: {
    currentTimeRef: { current: 0 },
    durationRef: { current: 0 },
    isPlayingRef: { current: false },
    ratingKeyRef: { current: "" },
    startTimeline: vi.fn(),
    stopTimeline: vi.fn(),
    reportStopped: vi.fn(),
  },
}));

vi.mock("../useAuth", () => ({
  useAuth: () => ({
    server: serverMock,
    isAuthenticated: true,
    serverSelected: true,
  }),
}));

vi.mock("../usePreferences", () => ({
  usePreferences: () => ({
    preferences: {
      playback: {
        quality: "original",
        preferredAudioLanguage: "",
        preferredSubtitleLanguage: "",
        defaultSubtitles: "auto",
        subtitleSize: 100,
        audioBoost: 1,
        directPlayPreference: "auto",
        volumeBoost: 1,
        normalizationPreset: "off",
        audioOffsetMs: 0,
        skipIntroEnabled: true,
        skipCreditsEnabled: true,
        autoPlayEnabled: true,
        subtitleStyle: {
          fontFamily: "Arial",
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          backgroundOpacity: 0.5,
          outlineColor: "#000000",
          outlineWidth: 1,
          shadowEnabled: true,
        },
      },
      appearance: {
        theme: "system",
        posterSize: "medium",
        sidebarCollapsed: false,
        dashboardSections: {
          continueWatching: true,
          recentMovies: true,
          recentShows: true,
        },
        skipSingleSeason: false,
        minCollectionSize: 2,
      },
    },
    updatePreferences: vi.fn(),
  }),
}));

// useTimelineReporting returns refs + start/stop/reportStopped — stub the
// minimum surface useNativePlayer uses.
vi.mock("./useTimelineReporting", () => ({
  useTimelineReporting: () => timelineMock,
}));

vi.mock("../../services/plex-playback", () => ({
  prepareSource: vi.fn().mockResolvedValue(null),
  applyPreparedMetadata: vi.fn(),
  refreshDownloadedSubtitles: vi.fn().mockResolvedValue(undefined),
  deriveDisplayTitles: vi.fn(() => ({ title: "", subtitle: "" })),
  reportTimeline: vi.fn(),
  getSavedVolume: () => 1,
  saveVolume: vi.fn(),
}));

vi.mock("../../services/storage", () => ({
  addPendingWatchSync: vi.fn(),
  getClientIdentifier: vi.fn().mockResolvedValue("client-id"),
}));

// Capture all listen() handlers keyed by event name so tests can fire
// player://ready, player://eof, etc. on demand.
const { eventHandlers } = vi.hoisted(() => {
  const handlers: Record<string, ((evt: { payload: unknown }) => void)[]> = {};
  return { eventHandlers: handlers };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, handler: (evt: { payload: unknown }) => void) => {
      if (!eventHandlers[name]) eventHandlers[name] = [];
      eventHandlers[name].push(handler);
      return () => {
        const list = eventHandlers[name] ?? [];
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
  ),
  emit: vi.fn().mockResolvedValue(undefined),
  emitTo: vi.fn().mockResolvedValue(undefined),
  once: vi.fn().mockResolvedValue(() => {}),
  TauriEvent: {},
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { prepareSource } from "../../services/plex-playback";
import { useNativePlayer } from "./useNativePlayer";
import {
  __resetEngineFallbackForTests,
  consumePendingResumeOffsetMs,
  isSessionFallbackActive,
} from "./engineResolution";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(eventHandlers)) delete eventHandlers[k];
  // restoreMocks wipes vi.fn impls between tests; re-install the listen
  // capture so player://* subscriptions keep landing in eventHandlers.
  vi.mocked(listen).mockImplementation(
    async (name: string, handler: (evt: { payload: unknown }) => void) => {
      if (!eventHandlers[name]) eventHandlers[name] = [];
      eventHandlers[name].push(handler);
      return () => {
        const list = eventHandlers[name] ?? [];
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
  );
  // engineResolution's session-fallback flag is a real module-level
  // singleton (not mocked in this file) — reset it so prexu-axj4.4's
  // fallback tests below don't leak state into each other.
  __resetEngineFallbackForTests();
});

function fireReady() {
  const subs = eventHandlers["player://ready"];
  if (!subs || subs.length === 0) {
    throw new Error("player://ready handlers not registered yet");
  }
  for (const h of subs) h({ payload: null });
}

function fireEof() {
  const subs = eventHandlers["player://eof"];
  if (!subs || subs.length === 0) {
    throw new Error("player://eof handlers not registered yet");
  }
  for (const h of subs) h({ payload: null });
}

describe("useNativePlayer dispatch contract (prexu-ve9)", () => {
  describe("subscribeToEof", () => {
    it("attaches a handler that fires when player://eof is emitted", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));

      // The hook's internal listen() registrations are async; wait for the
      // player://eof handler to appear before subscribing on top of it.
      await waitFor(() => {
        expect(eventHandlers["player://eof"]?.length ?? 0).toBeGreaterThan(0);
      });

      const handler = vi.fn();
      const unsubscribe = result.current.subscribeToEof(handler);

      act(() => {
        fireEof();
      });

      expect(handler).toHaveBeenCalledTimes(1);

      // Unsubscribe stops further deliveries.
      unsubscribe();
      act(() => {
        fireEof();
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("applySubtitleStyle", () => {
    it("defers the invoke until player://ready, then dispatches with the cached payload", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));

      // Call BEFORE ready — should not hit invoke yet.
      act(() => {
        result.current.applySubtitleStyle({
          size: 120,
          style: {
            fontFamily: "Arial",
            textColor: "#FFFFFF",
            backgroundColor: "#000000",
            backgroundOpacity: 0.5,
            outlineColor: "#000000",
            outlineWidth: 2,
            shadowEnabled: true,
          },
        });
      });

      expect(invoke).not.toHaveBeenCalledWith(
        "player_apply_sub_style",
        expect.anything(),
      );

      // Wait for ready listener registration, then fire ready.
      await waitFor(() => {
        expect(eventHandlers["player://ready"]?.length ?? 0).toBeGreaterThan(0);
      });

      act(() => {
        fireReady();
      });

      expect(invoke).toHaveBeenCalledWith("player_apply_sub_style", {
        style: {
          size: 120,
          fontFamily: "Arial",
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          backgroundOpacity: 0.5,
          outlineColor: "#000000",
          outlineWidth: 2,
          shadowEnabled: true,
        },
      });
    });

    it("invokes immediately when called after mpv is ready", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(eventHandlers["player://ready"]?.length ?? 0).toBeGreaterThan(0);
      });

      // Fire ready first — flushes empty pending state.
      act(() => {
        fireReady();
      });

      vi.mocked(invoke).mockClear();

      act(() => {
        result.current.applySubtitleStyle({
          size: 80,
          style: {
            fontFamily: "Verdana",
            textColor: "#FFFF00",
            backgroundColor: "#101010",
            backgroundOpacity: 0.25,
            outlineColor: "#202020",
            outlineWidth: 0,
            shadowEnabled: false,
          },
        });
      });

      expect(invoke).toHaveBeenCalledWith("player_apply_sub_style", {
        style: {
          size: 80,
          fontFamily: "Verdana",
          textColor: "#FFFF00",
          backgroundColor: "#101010",
          backgroundOpacity: 0.25,
          outlineColor: "#202020",
          outlineWidth: 0,
          shadowEnabled: false,
        },
      });
    });
  });

  describe("initPlayback supersession (prexu-bgz.2)", () => {
    type Prepared = Awaited<ReturnType<typeof prepareSource>>;

    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    }

    function makePrepared(url: string, title: string): Prepared {
      return {
        item: { type: "movie", title },
        playable: { Marker: [], duration: 60000 },
        part: { id: 1, Chapter: [] },
        categorized: { audio: [], subtitles: [] },
        defaultAudio: undefined,
        defaultSub: undefined,
        isLocal: false,
        sourceKind: "hls",
        url,
        viewOffset: 0,
      } as unknown as Prepared;
    }

    it("ignores a stale prepareSource result after a newer init starts", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);
      const first = deferred<Prepared>();
      const second = deferred<Prepared>();
      vi.mocked(prepareSource)
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise);

      const { rerender } = renderHook(
        ({ rk }: { rk: string }) => useNativePlayer(rk),
        { initialProps: { rk: "100" } },
      );

      // Let generation 1's one-time player_engine_status pre-flight
      // (prexu-axj4.4) resolve before starting generation 2 — otherwise
      // gen 1 would be superseded while still awaiting that check and
      // would never reach prepareSource at all, which isn't the race
      // this test is exercising. The check only runs once per mount, so
      // this doesn't affect generation 2's behavior below.
      await waitFor(() => {
        expect(prepareSource).toHaveBeenCalledTimes(1);
      });

      // Second episode starts while the first is still preparing.
      rerender({ rk: "200" });
      expect(prepareSource).toHaveBeenCalledTimes(2);

      // The first (now stale) prepare resolves late.
      await act(async () => {
        first.resolve(makePrepared("https://server/old.mkv", "Old Episode"));
        await first.promise;
        await Promise.resolve();
      });

      // Stale url must never be sent to mpv.
      expect(invoke).not.toHaveBeenCalledWith(
        "player_load_url",
        expect.objectContaining({ url: "https://server/old.mkv" }),
      );

      // The current init proceeds normally once its prepare resolves.
      await act(async () => {
        second.resolve(makePrepared("https://server/new.mkv", "New Episode"));
        await second.promise;
      });

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("player_load_url", {
          url: "https://server/new.mkv",
          headers: {},
          startOffsetMs: 0,
        });
      });
      expect(invoke).not.toHaveBeenCalledWith(
        "player_load_url",
        expect.objectContaining({ url: "https://server/old.mkv" }),
      );
    });

    it("does not load anything when the hook unmounts mid-init", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);
      const first = deferred<Prepared>();
      vi.mocked(prepareSource).mockImplementationOnce(() => first.promise);

      const { unmount } = renderHook(() => useNativePlayer("100"));
      unmount();
      vi.mocked(invoke).mockClear();

      first.resolve(makePrepared("https://server/old.mkv", "Old Episode"));
      await first.promise;
      await Promise.resolve();

      expect(invoke).not.toHaveBeenCalledWith(
        "player_load_url",
        expect.anything(),
      );
    });
  });

  describe("applyAudioEnhancement", () => {
    it("invokes both player_set_af_chain and player_set_audio_delay_ms when both fields supplied (post-ready)", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(eventHandlers["player://ready"]?.length ?? 0).toBeGreaterThan(0);
      });

      act(() => {
        fireReady();
      });

      vi.mocked(invoke).mockClear();

      act(() => {
        result.current.applyAudioEnhancement({
          normalizationPreset: "night",
          audioOffsetMs: 500,
        });
      });

      expect(invoke).toHaveBeenCalledWith("player_set_af_chain", {
        preset: "night",
      });
      expect(invoke).toHaveBeenCalledWith("player_set_audio_delay_ms", {
        ms: 500,
      });
    });

    it("defers IPC until ready and flushes the pending state on player://ready", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));

      act(() => {
        result.current.applyAudioEnhancement({
          normalizationPreset: "light",
          audioOffsetMs: -250,
        });
      });

      // Nothing invoked yet — pre-ready calls are buffered.
      expect(invoke).not.toHaveBeenCalledWith(
        "player_set_af_chain",
        expect.anything(),
      );
      expect(invoke).not.toHaveBeenCalledWith(
        "player_set_audio_delay_ms",
        expect.anything(),
      );

      await waitFor(() => {
        expect(eventHandlers["player://ready"]?.length ?? 0).toBeGreaterThan(0);
      });

      act(() => {
        fireReady();
      });

      expect(invoke).toHaveBeenCalledWith("player_set_af_chain", {
        preset: "light",
      });
      expect(invoke).toHaveBeenCalledWith("player_set_audio_delay_ms", {
        ms: -250,
      });
    });
  });

  describe("chrome slice stability (prexu-bgz.5)", () => {
    function fire(name: string, payload: unknown) {
      const subs = eventHandlers[name];
      if (!subs || subs.length === 0) {
        throw new Error(`${name} handlers not registered yet`);
      }
      for (const h of subs) h({ payload });
    }

    it("keeps chrome identity across time-pos/buffered ticks while the live values update", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(eventHandlers["player://time-pos"]?.length ?? 0).toBeGreaterThan(0);
      });
      // Let the async init settle (mocked prepareSource resolves null →
      // error path flips isLoading false) so the snapshot below isn't
      // invalidated by trailing init state updates.
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const chromeBefore = result.current.chrome;

      act(() => {
        fire("player://time-pos", 12.5);
      });
      expect(result.current.currentTime).toBe(12.5);
      expect(result.current.chrome).toBe(chromeBefore);

      act(() => {
        fire("player://buffered", 30);
      });
      expect(result.current.buffered).toBe(30);
      expect(result.current.chrome).toBe(chromeBefore);

      act(() => {
        fire("player://time-pos", 12.75);
      });
      expect(result.current.currentTime).toBe(12.75);
      expect(result.current.chrome).toBe(chromeBefore);
    });

    it("swaps chrome identity when non-tick state actually changes", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(eventHandlers["player://paused"]?.length ?? 0).toBeGreaterThan(0);
      });
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const chromeBefore = result.current.chrome;

      // paused=false → isPlaying true — a genuine chrome state transition.
      act(() => {
        fire("player://paused", false);
      });
      expect(result.current.isPlaying).toBe(true);
      expect(result.current.chrome).not.toBe(chromeBefore);
      expect(result.current.chrome.isPlaying).toBe(true);
    });

    it("keeps action callbacks identity-stable across ticks and play state changes", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(eventHandlers["player://time-pos"]?.length ?? 0).toBeGreaterThan(0);
      });
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const { togglePlay, seek, setFullscreen, subscribeToEof, pause, unload } =
        result.current;

      act(() => {
        fire("player://time-pos", 60);
        fire("player://paused", false);
      });

      expect(result.current.togglePlay).toBe(togglePlay);
      expect(result.current.seek).toBe(seek);
      expect(result.current.setFullscreen).toBe(setFullscreen);
      expect(result.current.subscribeToEof).toBe(subscribeToEof);
      expect(result.current.pause).toBe(pause);
      expect(result.current.unload).toBe(unload);
    });
  });

  // ── enqueueOrRun / flushOnReady queue semantics (prexu-bgz.32) ──

  describe("deferred-op queue (prexu-bgz.32)", () => {
    it("flushes sub-style and af-chain in insertion order on player://ready", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(eventHandlers["player://ready"]?.length ?? 0).toBeGreaterThan(0);
      });

      const callOrder: string[] = [];
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        callOrder.push(cmd as string);
        return undefined;
      });

      // Enqueue ops before ready fires.
      act(() => {
        result.current.applySubtitleStyle({
          size: 100,
          style: {
            fontFamily: "Arial",
            textColor: "#fff",
            backgroundColor: "#000",
            backgroundOpacity: 0.5,
            outlineColor: "#000",
            outlineWidth: 1,
            shadowEnabled: false,
          },
        });
        result.current.applyAudioEnhancement({ normalizationPreset: "night" });
        result.current.applyAudioEnhancement({ audioOffsetMs: 200 });
      });

      // Nothing fired yet.
      expect(callOrder.filter((c) => c.startsWith("player_"))).toHaveLength(0);

      // Fire ready — ops should flush in insertion order.
      act(() => {
        fireReady();
      });

      // sub-style was enqueued first, then af-chain, then audio-delay.
      expect(callOrder).toEqual([
        "player_apply_sub_style",
        "player_set_af_chain",
        "player_set_audio_delay_ms",
      ]);
    });

    it("replaces a pending sub-style with the latest when called twice pre-ready", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(eventHandlers["player://ready"]?.length ?? 0).toBeGreaterThan(0);
      });

      vi.mocked(invoke).mockResolvedValue(undefined);

      act(() => {
        result.current.applySubtitleStyle({
          size: 80,
          style: {
            fontFamily: "Old",
            textColor: "#000",
            backgroundColor: "#fff",
            backgroundOpacity: 1,
            outlineColor: "#fff",
            outlineWidth: 0,
            shadowEnabled: false,
          },
        });
        // Second call should REPLACE the first in the queue.
        result.current.applySubtitleStyle({
          size: 120,
          style: {
            fontFamily: "New",
            textColor: "#fff",
            backgroundColor: "#000",
            backgroundOpacity: 0,
            outlineColor: "#000",
            outlineWidth: 2,
            shadowEnabled: true,
          },
        });
      });

      act(() => {
        fireReady();
      });

      // Only one player_apply_sub_style invocation with the latest args.
      const subStyleCalls = vi.mocked(invoke).mock.calls.filter(
        ([cmd]) => cmd === "player_apply_sub_style",
      );
      expect(subStyleCalls).toHaveLength(1);
      expect(subStyleCalls[0][1]).toMatchObject({ style: { fontFamily: "New", size: 120 } });
    });

    it("fires immediately post-ready without queuing", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(eventHandlers["player://ready"]?.length ?? 0).toBeGreaterThan(0);
      });

      act(() => {
        fireReady();
      });

      vi.mocked(invoke).mockClear();

      act(() => {
        result.current.applySubtitleStyle({
          size: 100,
          style: {
            fontFamily: "Arial",
            textColor: "#fff",
            backgroundColor: "#000",
            backgroundOpacity: 0.5,
            outlineColor: "#000",
            outlineWidth: 1,
            shadowEnabled: false,
          },
        });
      });

      // Post-ready: invoke fires synchronously within the act.
      expect(invoke).toHaveBeenCalledWith(
        "player_apply_sub_style",
        expect.objectContaining({ style: expect.objectContaining({ fontFamily: "Arial" }) }),
      );
    });
  });

  describe("engine field", () => {
    it("reports engine: 'native'", async () => {
      const { result } = renderHook(() => useNativePlayer("123"));
      await waitFor(() => {
        expect(eventHandlers["player://ready"]?.length ?? 0).toBeGreaterThan(0);
      });
      expect(result.current.engine).toBe("native");
    });
  });

  describe("player_engine_status pre-flight (prexu-axj4.4)", () => {
    it("proceeds with native init when engine status omits a shape (default test mock resolves undefined)", async () => {
      // Default mock resolves every invoke() call with `undefined` — this
      // documents that an unrecognized/undefined response is treated as
      // "available" (never crashes, never spuriously falls back), matching
      // the contract: only an explicit available:false or a rejection
      // should downgrade to HTML5.
      vi.mocked(prepareSource).mockResolvedValue({
        item: { type: "movie", title: "T" },
        playable: { Marker: [], duration: 60000 },
        part: { id: 1, Chapter: [] },
        categorized: { audio: [], subtitles: [] },
        defaultAudio: undefined,
        defaultSub: undefined,
        isLocal: false,
        sourceKind: "hls",
        url: "https://server/index.m3u8",
        viewOffset: 0,
      } as unknown as Awaited<ReturnType<typeof prepareSource>>);

      renderHook(() => useNativePlayer("123"));
      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("player_engine_status");
      });
      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith(
          "player_load_url",
          expect.objectContaining({ url: expect.any(String) }),
        );
      });
      expect(isSessionFallbackActive()).toBe(false);
    });

    it("falls back to HTML5 (session-fallback flag) when player_engine_status reports available:false", async () => {
      vi.mocked(prepareSource).mockResolvedValue(null);
      vi.mocked(invoke).mockImplementation((cmd: unknown) => {
        if (cmd === "player_engine_status") {
          return Promise.resolve({ available: false, reason: "render init failed" });
        }
        return Promise.resolve(undefined);
      });

      renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(isSessionFallbackActive()).toBe(true);
      });
      // Bailed out before ever attempting player_load_url.
      expect(invoke).not.toHaveBeenCalledWith(
        "player_load_url",
        expect.anything(),
      );
    });

    it("falls back to HTML5 when the player_engine_status invoke rejects (command not registered yet)", async () => {
      vi.mocked(invoke).mockImplementation((cmd: unknown) => {
        if (cmd === "player_engine_status") {
          return Promise.reject(new Error("command player_engine_status not found"));
        }
        return Promise.resolve(undefined);
      });

      renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(isSessionFallbackActive()).toBe(true);
      });
      expect(invoke).not.toHaveBeenCalledWith(
        "player_load_url",
        expect.anything(),
      );
    });

    it("only checks engine status once per mount, not on every episode handoff", async () => {
      // restoreMocks (vitest.config.ts) wipes the module-level factory
      // defaults before every test, so invoke/prepareSource must be given
      // explicit implementations here rather than relying on the factory's
      // `.mockResolvedValue(...)` — that's already gone by the time this
      // test runs.
      vi.mocked(invoke).mockResolvedValue(undefined);
      vi.mocked(prepareSource).mockResolvedValue({
        item: { type: "movie", title: "T" },
        playable: { Marker: [], duration: 60000 },
        part: { id: 1, Chapter: [] },
        categorized: { audio: [], subtitles: [] },
        defaultAudio: undefined,
        defaultSub: undefined,
        isLocal: false,
        sourceKind: "hls",
        url: "https://server/index.m3u8",
        viewOffset: 0,
      } as unknown as Awaited<ReturnType<typeof prepareSource>>);

      const { rerender } = renderHook(
        ({ rk }: { rk: string }) => useNativePlayer(rk),
        { initialProps: { rk: "100" } },
      );
      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("player_engine_status");
      });
      const callsAfterFirst = vi.mocked(invoke).mock.calls.filter(
        (c) => c[0] === "player_engine_status",
      ).length;
      expect(callsAfterFirst).toBe(1);

      // Let generation 1 fully clear the (one-time) pre-flight check and
      // reach prepareSource before starting generation 2 — otherwise gen 1
      // would be superseded mid-check and never call prepareSource, which
      // would make the "called twice" assertion below hang forever.
      await waitFor(() => {
        expect(prepareSource).toHaveBeenCalledTimes(1);
      });

      rerender({ rk: "200" });
      await waitFor(() => {
        expect(prepareSource).toHaveBeenCalledTimes(2);
      });
      const callsAfterSecond = vi.mocked(invoke).mock.calls.filter(
        (c) => c[0] === "player_engine_status",
      ).length;
      expect(callsAfterSecond).toBe(1);
    });
  });

  describe("player://engine-failed runtime fallback (prexu-axj4.4)", () => {
    function fireEngineFailed(reason: string) {
      const subs = eventHandlers["player://engine-failed"];
      if (!subs || subs.length === 0) {
        throw new Error("player://engine-failed handlers not registered yet");
      }
      for (const h of subs) h({ payload: reason });
    }

    it("sets the session-fallback flag when the event fires", async () => {
      renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(eventHandlers["player://engine-failed"]?.length ?? 0).toBeGreaterThan(0);
      });

      expect(isSessionFallbackActive()).toBe(false);

      act(() => {
        fireEngineFailed("GL context lost");
      });

      expect(isSessionFallbackActive()).toBe(true);
    });

    it("stashes the last known playback position as the pending resume offset", async () => {
      renderHook(() => useNativePlayer("123"));

      await waitFor(() => {
        expect(eventHandlers["player://time-pos"]?.length ?? 0).toBeGreaterThan(0);
      });

      act(() => {
        const timeSubs = eventHandlers["player://time-pos"];
        for (const h of timeSubs) h({ payload: 42.5 });
      });

      await waitFor(() => {
        expect(eventHandlers["player://engine-failed"]?.length ?? 0).toBeGreaterThan(0);
      });

      act(() => {
        fireEngineFailed("render init failed");
      });

      expect(consumePendingResumeOffsetMs()).toBe(42500);
      // One-shot — a second read comes back empty.
      expect(consumePendingResumeOffsetMs()).toBeNull();
    });
  });
});

// ── Mute scope: per-session by design (prexu-jphh) ──────────────────────────
//
// DESIGN DECISION (bd memory player-mute-scope-decision): mute carries across
// episode handoff/autoplay WITHIN one player session (same mount — see the
// reveal-mute test "(a) keeps the user muted across the reveal" below), but a
// stop unmounts the hook and the next session deliberately starts unmuted.
// Mute is NOT persisted like volume — PR #38 tried and was reverted. This
// test pins the reset so persistence isn't reintroduced by accident.
describe("mute scope (prexu-jphh)", () => {
  it("a fresh session starts unmuted even when the previous session ended muted", async () => {
    const first = renderHook(() => useNativePlayer("ep1"));
    act(() => {
      first.result.current.toggleMute();
    });
    expect(first.result.current.isMuted).toBe(true);
    // User stops playback — the player (and this hook) unmounts.
    first.unmount();

    // Next play (same or different item) is a brand-new session: unmuted.
    const second = renderHook(() => useNativePlayer("ep2"));
    expect(second.result.current.isMuted).toBe(false);
  });
});

// ── Linux-only reveal-mute workaround (prexu-axj4.5) ────────────────────────
//
// On Linux native, ~1s of audio is audible under the loading screen before
// the first video frame reveals (Windows does not exhibit this,
// user-confirmed). The fix mutes before player_load_url and restores the
// user's current muted preference on player://host-window-ready.
//
// IS_LINUX_NATIVE_PLAYER is a module-level const derived from
// navigator.userAgent + window.__TAURI_INTERNALS__ at import time — jsdom's
// defaults (no Tauri marker) make it false, which is exactly what every
// OTHER test in this file already relies on (proving requirement (e): zero
// behavior change on non-Linux/HTML5 by construction, since none of them
// touch this describe block's mocking at all). To exercise the Linux path
// we force-remock engineResolution and dynamically re-import useNativePlayer
// per test — @tauri-apps/api/core's `invoke` and @tauri-apps/api/event's
// `listen` mocks keep their identity across vi.resetModules() (verified:
// vi.mock-intercepted specifiers are not re-instantiated the way ordinary
// modules are), so asserting against the top-level `invoke`/`listen`
// imports stays valid for the freshly-loaded module too.
describe("Linux-only reveal-mute workaround (prexu-axj4.5)", () => {
  type Prepared = Awaited<ReturnType<typeof prepareSource>>;

  function makePrepared(url: string): Prepared {
    return {
      item: { type: "movie", title: "Reveal Mute Test" },
      playable: { Marker: [], duration: 60000 },
      part: { id: 1, Chapter: [] },
      categorized: { audio: [], subtitles: [] },
      defaultAudio: undefined,
      defaultSub: undefined,
      isLocal: false,
      sourceKind: "hls",
      url,
      viewOffset: 0,
    } as unknown as Prepared;
  }

  async function loadLinuxNativePlayer() {
    vi.resetModules();
    vi.doMock("./engineResolution", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./engineResolution")>()),
      IS_LINUX_NATIVE_PLAYER: true,
    }));
    const mod = await import("./useNativePlayer");
    return mod.useNativePlayer;
  }

  function fireHostWindowReady() {
    const subs = eventHandlers["player://host-window-ready"];
    if (!subs || subs.length === 0) {
      throw new Error("player://host-window-ready handlers not registered yet");
    }
    for (const h of subs) h({ payload: null });
  }

  function mutedInvokeCalls() {
    return vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "player_set_muted")
      .map(([, args]) => (args as { muted: boolean }).muted);
  }

  beforeEach(() => {
    vi.mocked(prepareSource).mockResolvedValue(makePrepared("https://server/video.m3u8"));
  });

  it("mutes before player_load_url, then restores to the user's (unmuted) state on host-window-ready", async () => {
    const useNativePlayerLinux = await loadLinuxNativePlayer();
    renderHook(() => useNativePlayerLinux("123"));

    await waitFor(() => {
      expect(eventHandlers["player://host-window-ready"]?.length ?? 0).toBeGreaterThan(0);
    });

    const calls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    const muteIdx = calls.indexOf("player_set_muted");
    const loadIdx = calls.indexOf("player_load_url");
    expect(muteIdx).toBeGreaterThanOrEqual(0);
    expect(loadIdx).toBeGreaterThan(muteIdx);
    expect(mutedInvokeCalls()).toEqual([true]);

    act(() => {
      fireHostWindowReady();
    });

    expect(mutedInvokeCalls()).toEqual([true, false]);
  });

  it("(a) keeps the user muted across the reveal when they were already muted", async () => {
    const useNativePlayerLinux = await loadLinuxNativePlayer();
    const { result, rerender } = renderHook(
      ({ rk }: { rk: string }) => useNativePlayerLinux(rk),
      { initialProps: { rk: "ep1" } },
    );

    // First load completes normally.
    await waitFor(() => {
      expect(eventHandlers["player://host-window-ready"]?.length ?? 0).toBeGreaterThan(0);
    });
    act(() => {
      fireHostWindowReady();
    });
    expect(mutedInvokeCalls()).toEqual([true, false]);

    // A genuine, deliberate mute mid-episode-1 (not a reveal artifact).
    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.isMuted).toBe(true);

    // Autoplay advances to episode 2 — a fresh load re-arms reveal-mute.
    rerender({ rk: "ep2" });
    await waitFor(() => {
      const afterRerenderCalls = mutedInvokeCalls();
      expect(afterRerenderCalls[afterRerenderCalls.length - 1]).toBe(true);
    });

    act(() => {
      fireHostWindowReady();
    });

    // Restore uses the user's CURRENT muted state (still true) — the reveal
    // must not silently drop them back to unmuted.
    const finalCalls = mutedInvokeCalls();
    expect(finalCalls[finalCalls.length - 1]).toBe(true);
    expect(result.current.isMuted).toBe(true);
  });

  it("(b) a mid-load toggle never reaches mpv early — only the latest intent applies at reveal", async () => {
    const useNativePlayerLinux = await loadLinuxNativePlayer();
    const { result } = renderHook(() => useNativePlayerLinux("123"));

    await waitFor(() => {
      expect(eventHandlers["player://host-window-ready"]?.length ?? 0).toBeGreaterThan(0);
    });
    expect(mutedInvokeCalls()).toEqual([true]); // arm only, so far

    // User toggles mute twice while the loading screen is still up.
    act(() => {
      result.current.toggleMute(); // false -> true (UI reflects it immediately)
    });
    expect(result.current.isMuted).toBe(true);
    act(() => {
      result.current.toggleMute(); // true -> false (changed their mind)
    });
    expect(result.current.isMuted).toBe(false);

    // Neither toggle reached mpv — no unmute (false) was ever sent while
    // armed, so no early audio leaked out under the loading screen.
    expect(mutedInvokeCalls()).toEqual([true]);

    act(() => {
      fireHostWindowReady();
    });

    // The LAST toggle (unmuted) is what gets applied at reveal.
    expect(mutedInvokeCalls()).toEqual([true, false]);
  });

  it("(c) re-arms per load across consecutive episode loads (autoplay path)", async () => {
    const useNativePlayerLinux = await loadLinuxNativePlayer();
    const { rerender } = renderHook(
      ({ rk }: { rk: string }) => useNativePlayerLinux(rk),
      { initialProps: { rk: "ep1" } },
    );

    await waitFor(() => {
      expect(eventHandlers["player://host-window-ready"]?.length ?? 0).toBeGreaterThan(0);
    });
    expect(mutedInvokeCalls()).toEqual([true]);

    act(() => {
      fireHostWindowReady();
    });
    expect(mutedInvokeCalls()).toEqual([true, false]);

    // Episode 2: a brand new arm must fire again — the workaround does not
    // just apply once per mount.
    rerender({ rk: "ep2" });
    await waitFor(() => {
      expect(mutedInvokeCalls()).toEqual([true, false, true]);
    });

    act(() => {
      fireHostWindowReady();
    });
    expect(mutedInvokeCalls()).toEqual([true, false, true, false]);
  });

  it("(d) tears down the pending listener on unmount mid-load — no invoke or dangling subscription afterward", async () => {
    const useNativePlayerLinux = await loadLinuxNativePlayer();
    const { unmount } = renderHook(() => useNativePlayerLinux("123"));

    await waitFor(() => {
      expect(eventHandlers["player://host-window-ready"]?.length ?? 0).toBeGreaterThan(0);
    });
    expect(mutedInvokeCalls()).toEqual([true]);

    unmount();

    // The listener registered for this load must be gone — nothing left to
    // fire, proving there's no dangling subscription past teardown.
    expect(eventHandlers["player://host-window-ready"] ?? []).toHaveLength(0);

    vi.mocked(invoke).mockClear();
    // Nothing left to invoke post-unmount; the array being empty above is
    // the real proof, this just documents there's no further mute traffic.
    expect(mutedInvokeCalls()).toEqual([]);
  });

  it("(e) never arms on the default (non-Linux) build — zero behavior change", async () => {
    // Uses the file's regular, statically-imported useNativePlayer (no
    // engineResolution remock) — IS_LINUX_NATIVE_PLAYER is false here under
    // jsdom's default (no Tauri marker), exactly like every other test in
    // this file.
    renderHook(() => useNativePlayer("123"));

    await waitFor(() => {
      expect(eventHandlers["player://ready"]?.length ?? 0).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "player_load_url",
        expect.objectContaining({ url: expect.any(String) }),
      );
    });

    // The only player_set_muted call is the ordinary post-load apply of the
    // user's (default, unmuted) preference — never a pre-load true-arm.
    expect(mutedInvokeCalls()).toEqual([false]);
  });
});
