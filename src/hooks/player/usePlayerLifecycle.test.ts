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
import { usePlayerLifecycle } from "./usePlayerLifecycle";
import type { UsePlayerResult } from "../usePlayer";
import type { UsePopOutPlayerResult } from "./usePopOutPlayer";
import type { PlayerSessionContextValue } from "../../contexts/PlayerContext";

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
    // ── Backend dispatch (prexu-ve9) ──
    // usePlayerLifecycle now drives unload + fullscreen exit through the
    // player contract rather than invoking directly. Tests assert on
    // these mocks rather than the underlying Tauri invoke channel.
    pause: vi.fn(),
    unload: vi.fn().mockResolvedValue(undefined),
    setFullscreen: vi.fn().mockResolvedValue(undefined),
    subscribeToEof: vi.fn(() => () => {}),
    applySubtitleStyle: vi.fn(),
    applyAudioEnhancement: vi.fn(),
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

function makePlayerSession(): Pick<PlayerSessionContextValue, "stop"> {
  return {
    stop: vi.fn(),
  };
}

/** Render the hook with a stable fullscreen ref. Returns the harness
 *  including the player mock so tests can assert on player.setFullscreen
 *  / player.unload directly — the prexu-ve9 contract is what we exercise
 *  here, not the underlying invoke calls. */
function setup(opts: {
  player?: Partial<UsePlayerResult>;
  popOut?: UsePopOutPlayerResult;
  isFullscreen?: boolean;
  playerSession?: Pick<PlayerSessionContextValue, "stop">;
} = {}) {
  const player = makePlayer(opts.player);
  const popOut = opts.popOut ?? makePopOut();
  const playerSession = opts.playerSession ?? makePlayerSession();
  const rendered = renderHook(() => {
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
  return { ...rendered, player, popOut, playerSession };
}

describe("usePlayerLifecycle", () => {
  describe("exit", () => {
    it("does NOT toggle popout when not popped out, but still unloads + stops", async () => {
      const popOut = makePopOut(false);
      const playerSession = makePlayerSession();
      const { result, player } = setup({ popOut, playerSession });

      await act(async () => {
        await result.current.lifecycle.exit();
      });

      expect(popOut.togglePopOut).not.toHaveBeenCalled();
      // Belt-and-suspenders: the transparent-body class must be cleared
      // by prepareNavAway (called inside exit) one render-cycle before
      // useTransparentWindow's unmount cleanup would otherwise handle it.
      expect(document.body.classList.contains("player-transparent")).toBe(false);
      // Fullscreen not active → no setFullscreen call.
      expect(player.setFullscreen).not.toHaveBeenCalled();
      // unload always runs through the player contract.
      expect(player.unload).toHaveBeenCalledTimes(1);
      expect(playerSession.stop).toHaveBeenCalledTimes(1);
    });

    it("exits popout FIRST when popped out, before unloading the player", async () => {
      const popOut = makePopOut(true);
      const playerSession = makePlayerSession();
      const callOrder: string[] = [];
      vi.mocked(popOut.togglePopOut).mockImplementation(() => {
        callOrder.push("togglePopOut");
      });
      const playerOverride: Partial<UsePlayerResult> = {
        unload: vi.fn(async () => {
          callOrder.push("player.unload");
        }),
      };
      vi.mocked(playerSession.stop).mockImplementation(() => {
        callOrder.push("stop");
      });

      const { result } = setup({ popOut, playerSession, player: playerOverride });

      await act(async () => {
        await result.current.lifecycle.exit();
      });

      // togglePopOut must come BEFORE player.unload.
      const popOutIdx = callOrder.indexOf("togglePopOut");
      const unloadIdx = callOrder.indexOf("player.unload");
      expect(popOutIdx).toBeGreaterThanOrEqual(0);
      expect(unloadIdx).toBeGreaterThan(popOutIdx);
      expect(callOrder[callOrder.length - 1]).toBe("stop");
    });

    it("exits fullscreen when active before unloading", async () => {
      const playerSession = makePlayerSession();
      const { result, player } = setup({ isFullscreen: true, playerSession });

      await act(async () => {
        await result.current.lifecycle.exit();
      });

      expect(player.setFullscreen).toHaveBeenCalledWith(false);
      expect(player.unload).toHaveBeenCalledTimes(1);
      expect(playerSession.stop).toHaveBeenCalledTimes(1);
    });

    it("still calls playerSession.stop even if player.unload rejects", async () => {
      const playerSession = makePlayerSession();
      const { result } = setup({
        playerSession,
        player: {
          unload: vi.fn().mockRejectedValue(new Error("unload failed")),
        },
      });

      await act(async () => {
        await result.current.lifecycle.exit();
      });

      expect(playerSession.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe("prepareNavAway", () => {
    it("clears the transparent-body class AND exits fullscreen via player contract when active", async () => {
      const { result, player } = setup({ isFullscreen: true });
      document.body.classList.add("player-transparent");

      await act(async () => {
        await result.current.lifecycle.prepareNavAway();
      });

      expect(document.body.classList.contains("player-transparent")).toBe(false);
      expect(player.setFullscreen).toHaveBeenCalledWith(false);
    });

    it("does NOT call player.setFullscreen when not fullscreen", async () => {
      const { result, player } = setup({ isFullscreen: false });
      await act(async () => {
        await result.current.lifecycle.prepareNavAway();
      });
      expect(player.setFullscreen).not.toHaveBeenCalled();
    });
  });

  describe("navAwayPreservingMount", () => {
    it("exits fullscreen then runs the nav callback — does NOT unload or stop", async () => {
      const playerSession = makePlayerSession();
      const nav = vi.fn();
      const { result, player } = setup({ isFullscreen: true, playerSession });

      await act(async () => {
        await result.current.lifecycle.navAwayPreservingMount(nav);
      });

      expect(player.setFullscreen).toHaveBeenCalledWith(false);
      expect(player.unload).not.toHaveBeenCalled();
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
