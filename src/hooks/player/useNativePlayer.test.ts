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
import { prepareSource, deriveDisplayTitles } from "../../services/plex-playback";
import { useNativePlayer } from "./useNativePlayer";

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
      vi.mocked(deriveDisplayTitles).mockImplementation((item) => ({
        title: (item as unknown as { title: string }).title,
        subtitle: "",
      }));
      const first = deferred<Prepared>();
      const second = deferred<Prepared>();
      vi.mocked(prepareSource)
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise);

      const { result, rerender } = renderHook(
        ({ rk }: { rk: string }) => useNativePlayer(rk),
        { initialProps: { rk: "100" } },
      );

      // Second episode starts while the first is still preparing.
      rerender({ rk: "200" });
      expect(prepareSource).toHaveBeenCalledTimes(2);

      // The first (now stale) prepare resolves late.
      await act(async () => {
        first.resolve(makePrepared("https://server/old.mkv", "Old Episode"));
        await first.promise;
        await Promise.resolve();
      });

      expect(invoke).not.toHaveBeenCalledWith(
        "player_load_url",
        expect.objectContaining({ url: "https://server/old.mkv" }),
      );
      expect(result.current.title).not.toBe("Old Episode");

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
      expect(result.current.title).toBe("New Episode");
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
});
