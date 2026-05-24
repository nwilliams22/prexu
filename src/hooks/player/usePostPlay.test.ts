/**
 * Tests for usePostPlay.
 *
 * Covers the EOF subscription branches (PostPlay vs onExit vs WT-suppressed),
 * the synchronous pause when PostPlay opens (native path), the mini-mode
 * handoff (autoplay → fire next; no-autoplay → restore), and ratingKey reset.
 *
 * Uses the native (IS_NATIVE_PLAYER=true) path throughout — the test
 * environment satisfies the Windows + __TAURI_INTERNALS__ checks once the
 * harness in beforeEach sets the internals object. The EOF effect on
 * native subscribes to `player://eof` via a dynamic import of
 * @tauri-apps/api/event, which we mock with a manual emitter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// usePlayer.ts evaluates IS_NATIVE_PLAYER as a module constant from
// `__TAURI_INTERNALS__ in window` AND a "Windows" userAgent substring.
// jsdom ships userAgent="...(win32)...", so the constant always resolves
// false in tests. Mock the module to expose IS_NATIVE_PLAYER=true so the
// EOF effect takes the native (mpv listen) branch we mock below.
// ── Mocks (must come before imports so the factory hoists correctly) ──────

vi.mock("../usePlayer", async () => {
  const actual = await vi.importActual<typeof import("../usePlayer")>(
    "../usePlayer",
  );
  return { ...actual, IS_NATIVE_PLAYER: true };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("../../services/plex-library", () => ({
  getItemMetadata: vi.fn().mockResolvedValue({
    summary: "next item summary",
    viewCount: 0,
    originallyAvailableAt: "2024-01-01",
  }),
}));

// Manual emitter for player://eof. vi.hoisted guarantees both the holder
// object AND the mock factory are run BEFORE any import statements (whether
// static or dynamic). The EOF effect dynamically imports
// @tauri-apps/api/event; the mock factory captures the listener.
const { eofMock } = vi.hoisted(() => {
  const holder: {
    handler: ((evt: { payload: unknown }) => void) | null;
    unlisten: (() => void) | null;
  } = { handler: null, unlisten: null };
  return { eofMock: holder };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (_name: string, h: (evt: { payload: unknown }) => void) => {
      eofMock.handler = h;
      const off = () => {
        eofMock.handler = null;
      };
      eofMock.unlisten = off;
      return off;
    },
  ),
  // Stub the other named exports the real module ships so anything else
  // that reaches for them gets a no-op instead of a transformCallback crash.
  emit: vi.fn().mockResolvedValue(undefined),
  emitTo: vi.fn().mockResolvedValue(undefined),
  once: vi.fn().mockResolvedValue(() => {}),
  TauriEvent: {},
}));

import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usePostPlay, type UsePostPlayArgs } from "./usePostPlay";
import type { UsePlayerResult } from "../usePlayer";
import type { PlaybackQueue, QueueItem } from "../../types/queue";

function triggerEof() {
  if (!eofMock.handler) {
    throw new Error("EOF handler not registered — effect did not run yet");
  }
  eofMock.handler({ payload: null });
}

// ── Test harness ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  eofMock.handler = null;
  eofMock.unlisten = null;
  // restoreMocks: true in vitest.config.ts wipes vi.fn impls between
  // tests; re-install the capturing impl so the EOF subscription effect
  // (a dynamic import inside usePostPlay) keeps resolving to our stub.
  vi.mocked(listen).mockImplementation(
    async (_name: string, h: (evt: { payload: unknown }) => void) => {
      eofMock.handler = h;
      const off = () => {
        eofMock.handler = null;
      };
      eofMock.unlisten = off;
      return off;
    },
  );
});

function makePlayer(): UsePlayerResult {
  return {
    videoRef: { current: null },
    title: "Test",
    subtitle: "",
    isLoading: false,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 1,
    isMuted: false,
    isFullscreen: false,
    playbackError: null,
    chapters: [],
    markers: [],
    itemType: "episode",
    parentRatingKey: "",
    audioTracks: [],
    subtitleTracks: [],
    selectedAudioId: null,
    selectedSubtitleId: null,
    togglePlay: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    toggleFullscreen: vi.fn(),
    selectAudioTrack: vi.fn(),
    selectSubtitleTrack: vi.fn(),
    retry: vi.fn(),
  } as UsePlayerResult;
}

function makeQueue(overrides: Partial<PlaybackQueue> = {}): PlaybackQueue {
  const items: QueueItem[] = [
    {
      ratingKey: "1",
      title: "Item 1",
      subtitle: "",
      thumb: "",
      duration: 60000,
      type: "episode",
    },
    {
      ratingKey: "2",
      title: "Item 2",
      subtitle: "",
      thumb: "",
      duration: 60000,
      type: "episode",
    },
  ];
  return {
    items,
    currentIndex: 0,
    source: "auto-episodes",
    ...overrides,
  };
}

function makeArgs(overrides: Partial<UsePostPlayArgs> = {}): UsePostPlayArgs {
  return {
    player: makePlayer(),
    queue: makeQueue(),
    ratingKey: "1",
    itemType: "episode",
    hasNextItem: true,
    wtInSession: false,
    isMinimized: false,
    autoPlayEnabled: false,
    server: { uri: "https://server", accessToken: "token" },
    onAdvanceNext: vi.fn(),
    onExit: vi.fn(),
    onRestoreFromMinimize: vi.fn(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("usePostPlay", () => {
  describe("EOF handling", () => {
    it("flips showPostPlay true when hasNextItem=true and not in WT", async () => {
      const args = makeArgs({ hasNextItem: true, wtInSession: false });
      const { result } = renderHook(() => usePostPlay(args));

      // Wait for the dynamic import + listen() registration.
      await waitFor(() => expect(eofMock.handler).not.toBeNull());

      act(() => {
        triggerEof();
      });

      await waitFor(() => {
        expect(result.current.showPostPlay).toBe(true);
      });
      expect(args.onExit).not.toHaveBeenCalled();
    });

    it("calls onExit (no PostPlay) when hasNextItem=false and not in WT", async () => {
      const args = makeArgs({ hasNextItem: false, wtInSession: false });
      const { result } = renderHook(() => usePostPlay(args));

      await waitFor(() => expect(eofMock.handler).not.toBeNull());

      act(() => {
        triggerEof();
      });

      expect(args.onExit).toHaveBeenCalledTimes(1);
      expect(result.current.showPostPlay).toBe(false);
    });

    it("does NOT fire PostPlay or exit when in a WT session — host drives flow", async () => {
      const args = makeArgs({ hasNextItem: true, wtInSession: true });
      const { result } = renderHook(() => usePostPlay(args));

      await waitFor(() => expect(eofMock.handler).not.toBeNull());

      act(() => {
        triggerEof();
      });

      expect(result.current.showPostPlay).toBe(false);
      expect(args.onExit).not.toHaveBeenCalled();
    });

    it("invokes player_pause synchronously when PostPlay opens (native path)", async () => {
      const args = makeArgs({ hasNextItem: true, wtInSession: false });
      renderHook(() => usePostPlay(args));

      await waitFor(() => expect(eofMock.handler).not.toBeNull());

      act(() => {
        triggerEof();
      });

      expect(invoke).toHaveBeenCalledWith("player_pause");
    });
  });

  describe("mini-mode handoff", () => {
    it("calls onAdvanceNext when minimized + showPostPlay + autoPlayEnabled=true", async () => {
      // PostPlay flips to true via EOF, then the mini-handoff effect fires.
      const args = makeArgs({
        hasNextItem: true,
        wtInSession: false,
        isMinimized: true,
        autoPlayEnabled: true,
      });
      renderHook(() => usePostPlay(args));

      await waitFor(() => expect(eofMock.handler).not.toBeNull());
      act(() => {
        triggerEof();
      });

      await waitFor(() => {
        expect(args.onAdvanceNext).toHaveBeenCalledTimes(1);
      });
      expect(args.onRestoreFromMinimize).not.toHaveBeenCalled();
    });

    it("calls onRestoreFromMinimize when minimized + showPostPlay + autoPlayEnabled=false", async () => {
      const args = makeArgs({
        hasNextItem: true,
        wtInSession: false,
        isMinimized: true,
        autoPlayEnabled: false,
      });
      renderHook(() => usePostPlay(args));

      await waitFor(() => expect(eofMock.handler).not.toBeNull());
      act(() => {
        triggerEof();
      });

      await waitFor(() => {
        expect(args.onRestoreFromMinimize).toHaveBeenCalledTimes(1);
      });
      expect(args.onAdvanceNext).not.toHaveBeenCalled();
    });

    it("does nothing when not minimized", async () => {
      const args = makeArgs({
        hasNextItem: true,
        wtInSession: false,
        isMinimized: false,
        autoPlayEnabled: true,
      });
      renderHook(() => usePostPlay(args));

      await waitFor(() => expect(eofMock.handler).not.toBeNull());
      act(() => {
        triggerEof();
      });

      // Wait a microtask so any scheduled effects run.
      await Promise.resolve();
      expect(args.onAdvanceNext).not.toHaveBeenCalled();
      expect(args.onRestoreFromMinimize).not.toHaveBeenCalled();
    });
  });

  describe("ratingKey reset", () => {
    it("clears showPostPlay and postPlayDetail when ratingKey changes", async () => {
      const args = makeArgs();
      const { result, rerender } = renderHook(
        (props: { args: UsePostPlayArgs }) => usePostPlay(props.args),
        { initialProps: { args } },
      );

      await waitFor(() => expect(eofMock.handler).not.toBeNull());
      act(() => {
        triggerEof();
      });
      await waitFor(() => {
        expect(result.current.showPostPlay).toBe(true);
      });

      // Swap ratingKey — reset effect should clear state.
      rerender({ args: { ...args, ratingKey: "2" } });

      await waitFor(() => {
        expect(result.current.showPostPlay).toBe(false);
        expect(result.current.postPlayDetail).toBeNull();
      });
    });
  });

  describe("nextQueueItem derivation", () => {
    it("returns the queue item at currentIndex+1, or null when exhausted", async () => {
      const baseArgs = makeArgs({ queue: makeQueue({ currentIndex: 0 }) });
      const { result, rerender } = renderHook(
        (props: { args: UsePostPlayArgs }) => usePostPlay(props.args),
        { initialProps: { args: baseArgs } },
      );

      // Wait for the EOF effect's dynamic-import listen registration so
      // any subsequent rerender's effect-cleanup runs against the mock,
      // not the real (un-mocked) module.
      await waitFor(() => expect(eofMock.handler).not.toBeNull());

      expect(result.current.nextQueueItem?.ratingKey).toBe("2");

      // Bump only the queue field — keep the rest of args stable so the
      // EOF effect doesn't re-subscribe.
      rerender({
        args: { ...baseArgs, queue: makeQueue({ currentIndex: 1 }) },
      });
      expect(result.current.nextQueueItem).toBeNull();
    });
  });
});
