/**
 * Tests for usePlayerLifecycle.
 *
 * The hook returns three exit-related callbacks. We cover the exit
 * choreography (popout-first ordering, fullscreen exit, mpv unload,
 * session.stop), prepareNavAway's fullscreen-exit, and
 * navAwayPreservingMount's "exit fullscreen then run nav" contract.
 *
 * IS_NATIVE_PLAYER is true under the jsdom + Tauri-stubbed test env
 * (see vitest setup) when navigator.userAgent contains "Windows" AND
 * window.__TAURI_INTERNALS__ is present. We force-stub both so the
 * native-path branches run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// usePlayer.ts evaluates IS_NATIVE_PLAYER as a module constant from
// `__TAURI_INTERNALS__ in window` AND a "Windows" userAgent substring.
// jsdom ships userAgent="...(win32)...", so the constant always resolves
// false in tests. Mock the module to expose IS_NATIVE_PLAYER=true so the
// native branches under test (fullscreen, body-bg, player_unload) run.
// We don't exercise usePlayer() itself here — the hook accepts the result
// as a plain arg — so a tiny stub is sufficient.
vi.mock("../usePlayer", async () => {
  const actual = await vi.importActual<typeof import("../usePlayer")>(
    "../usePlayer",
  );
  return { ...actual, IS_NATIVE_PLAYER: true };
});

import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerLifecycle } from "./usePlayerLifecycle";
import type { UsePlayerResult } from "../usePlayer";
import type { UsePopOutPlayerResult } from "./usePopOutPlayer";
import type { PlayerContextValue } from "../../contexts/PlayerContext";

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

beforeEach(() => {
  vi.clearAllMocks();
});

function makePlayer(overrides: Partial<UsePlayerResult> = {}): UsePlayerResult {
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
    itemType: "movie",
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
    ...overrides,
  } as UsePlayerResult;
}

function makePopOut(isPopOut = false): UsePopOutPlayerResult {
  return {
    isPopOut,
    isPopOutSupported: true,
    togglePopOut: vi.fn(),
  };
}

function makePlayerSession(): PlayerContextValue {
  return {
    session: { ratingKey: "1" },
    play: vi.fn(),
    stop: vi.fn(),
    replaceRatingKey: vi.fn(),
    updateSession: vi.fn(),
    isMinimized: false,
    minimize: vi.fn(),
    restoreFromMinimize: vi.fn(),
    miniRect: {
      corner: "bottom-right",
      width: 360,
      height: 200,
      padding: 12,
    },
    updateMiniRect: vi.fn(),
  };
}

/** Render the hook with a stable fullscreen ref. */
function setup(opts: {
  player?: Partial<UsePlayerResult>;
  popOut?: UsePopOutPlayerResult;
  isFullscreen?: boolean;
  playerSession?: PlayerContextValue;
} = {}) {
  const player = makePlayer(opts.player);
  const popOut = opts.popOut ?? makePopOut();
  const playerSession = opts.playerSession ?? makePlayerSession();
  return renderHook(() => {
    const isFullscreenRef = useRef(opts.isFullscreen ?? false);
    isFullscreenRef.current = opts.isFullscreen ?? false;
    return {
      lifecycle: usePlayerLifecycle({
        player,
        popOut,
        playerSession,
        isFullscreenRef,
      }),
      popOut,
      playerSession,
    };
  });
}

describe("usePlayerLifecycle", () => {
  describe("exit", () => {
    it("does NOT toggle popout when not popped out, but still unloads + stops", async () => {
      const popOut = makePopOut(false);
      const playerSession = makePlayerSession();
      const { result } = setup({ popOut, playerSession });

      await act(async () => {
        await result.current.lifecycle.exit();
      });

      expect(popOut.togglePopOut).not.toHaveBeenCalled();
      // Body-bg paint runs on native (prepareNavAway).
      expect(document.body.style.background).toBe("rgb(26, 26, 46)");
      // Fullscreen not active → no player_set_fullscreen call.
      expect(invoke).not.toHaveBeenCalledWith(
        "player_set_fullscreen",
        expect.anything(),
      );
      // mpv unload always runs on native.
      expect(invoke).toHaveBeenCalledWith("player_unload");
      expect(playerSession.stop).toHaveBeenCalledTimes(1);
    });

    it("exits popout FIRST when popped out, before unloading the player", async () => {
      const popOut = makePopOut(true);
      const playerSession = makePlayerSession();
      const callOrder: string[] = [];
      vi.mocked(popOut.togglePopOut).mockImplementation(() => {
        callOrder.push("togglePopOut");
      });
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        callOrder.push(`invoke:${cmd}`);
        return undefined as never;
      });
      vi.mocked(playerSession.stop).mockImplementation(() => {
        callOrder.push("stop");
      });

      const { result } = setup({ popOut, playerSession });

      await act(async () => {
        await result.current.lifecycle.exit();
      });

      // togglePopOut must come BEFORE player_unload.
      const popOutIdx = callOrder.indexOf("togglePopOut");
      const unloadIdx = callOrder.indexOf("invoke:player_unload");
      expect(popOutIdx).toBeGreaterThanOrEqual(0);
      expect(unloadIdx).toBeGreaterThan(popOutIdx);
      expect(callOrder[callOrder.length - 1]).toBe("stop");
    });

    it("exits fullscreen when active before unloading", async () => {
      const playerSession = makePlayerSession();
      const { result } = setup({ isFullscreen: true, playerSession });

      await act(async () => {
        await result.current.lifecycle.exit();
      });

      expect(invoke).toHaveBeenCalledWith("player_set_fullscreen", {
        fullscreen: false,
      });
      expect(invoke).toHaveBeenCalledWith("player_unload");
      expect(playerSession.stop).toHaveBeenCalledTimes(1);
    });

    it("still calls playerSession.stop even if player_unload rejects", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "player_unload") {
          throw new Error("unload failed");
        }
        return undefined as never;
      });
      const playerSession = makePlayerSession();
      const { result } = setup({ playerSession });

      await act(async () => {
        await result.current.lifecycle.exit();
      });

      expect(playerSession.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe("prepareNavAway", () => {
    it("paints body navy on native AND exits fullscreen when active", async () => {
      const { result } = setup({ isFullscreen: true });
      document.body.style.background = "transparent";

      await act(async () => {
        await result.current.lifecycle.prepareNavAway();
      });

      expect(document.body.style.background).toBe("rgb(26, 26, 46)");
      expect(invoke).toHaveBeenCalledWith("player_set_fullscreen", {
        fullscreen: false,
      });
    });

    it("does NOT call player_set_fullscreen when not fullscreen", async () => {
      const { result } = setup({ isFullscreen: false });
      await act(async () => {
        await result.current.lifecycle.prepareNavAway();
      });
      expect(invoke).not.toHaveBeenCalledWith(
        "player_set_fullscreen",
        expect.anything(),
      );
    });
  });

  describe("navAwayPreservingMount", () => {
    it("exits fullscreen then runs the nav callback — does NOT unload or stop", async () => {
      const playerSession = makePlayerSession();
      const nav = vi.fn();
      const { result } = setup({ isFullscreen: true, playerSession });

      await act(async () => {
        await result.current.lifecycle.navAwayPreservingMount(nav);
      });

      expect(invoke).toHaveBeenCalledWith("player_set_fullscreen", {
        fullscreen: false,
      });
      expect(invoke).not.toHaveBeenCalledWith("player_unload");
      expect(playerSession.stop).not.toHaveBeenCalled();
      expect(nav).toHaveBeenCalledTimes(1);
    });

    it("calls nav even when not fullscreen", async () => {
      const nav = vi.fn();
      const { result } = setup({ isFullscreen: false });

      await act(async () => {
        await result.current.lifecycle.navAwayPreservingMount(nav);
      });

      expect(nav).toHaveBeenCalledTimes(1);
    });
  });
});
