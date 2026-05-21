import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { PlayerProvider, usePlayerSession } from "./PlayerContext";
import * as playerService from "../services/player";
import { MINI_RECT_STORAGE_KEY } from "../utils/mini-rect";

vi.mock("../services/player", () => ({
  playerEnterMinimize: vi.fn().mockResolvedValue(undefined),
  playerExitMinimize: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <PlayerProvider>{children}</PlayerProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("PlayerContext", () => {
  it("starts with no session and not minimized", () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });
    expect(result.current.session).toBeNull();
    expect(result.current.isMinimized).toBe(false);
  });

  it("play() opens a session", () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });
    act(() => result.current.play("11102"));
    expect(result.current.session).toEqual({
      ratingKey: "11102",
      offset: undefined,
      watchTogether: undefined,
    });
  });

  it("minimize() invokes playerEnterMinimize with default rect (size, padding, corner) and flips isMinimized", async () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });

    await act(async () => {
      result.current.minimize();
      await Promise.resolve();
    });

    expect(playerService.playerEnterMinimize).toHaveBeenCalledTimes(1);
    expect(playerService.playerEnterMinimize).toHaveBeenCalledWith(
      360,
      200,
      16,
      "bottom-right",
    );
    expect(result.current.isMinimized).toBe(true);
  });

  it("restoreFromMinimize() invokes playerExitMinimize and clears isMinimized", async () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });

    await act(async () => {
      result.current.minimize();
      await Promise.resolve();
    });
    expect(result.current.isMinimized).toBe(true);

    await act(async () => {
      result.current.restoreFromMinimize();
      await Promise.resolve();
    });

    expect(playerService.playerExitMinimize).toHaveBeenCalledTimes(1);
    expect(result.current.isMinimized).toBe(false);
  });

  it("does not flip isMinimized when the underlying invoke rejects on enter", async () => {
    vi.mocked(playerService.playerEnterMinimize).mockRejectedValueOnce(
      new Error("rust failure"),
    );
    const { result } = renderHook(() => usePlayerSession(), { wrapper });

    await act(async () => {
      result.current.minimize();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isMinimized).toBe(false);
  });

  it("stop() clears the session AND resets isMinimized", async () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });
    act(() => result.current.play("11102"));

    await act(async () => {
      result.current.minimize();
      await Promise.resolve();
    });
    expect(result.current.isMinimized).toBe(true);
    expect(result.current.session).not.toBeNull();

    act(() => result.current.stop());
    expect(result.current.session).toBeNull();
    expect(result.current.isMinimized).toBe(false);
  });

  it("play() resets isMinimized when opening a new session over an old minimized one", async () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });
    act(() => result.current.play("11102"));

    await act(async () => {
      result.current.minimize();
      await Promise.resolve();
    });
    expect(result.current.isMinimized).toBe(true);

    act(() => result.current.play("22203"));
    expect(result.current.session?.ratingKey).toBe("22203");
    expect(result.current.isMinimized).toBe(false);
  });
});

describe("PlayerContext.miniRect", () => {
  it("exposes the default rect when nothing is persisted", () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });
    expect(result.current.miniRect).toEqual({
      corner: "bottom-right",
      width: 360,
      height: 200,
      padding: 16,
    });
  });

  it("seeds miniRect from localStorage on mount", () => {
    localStorage.setItem(
      MINI_RECT_STORAGE_KEY,
      JSON.stringify({
        corner: "top-left",
        width: 480,
        height: 270,
        padding: 20,
      }),
    );
    const { result } = renderHook(() => usePlayerSession(), { wrapper });
    expect(result.current.miniRect).toEqual({
      corner: "top-left",
      width: 480,
      height: 270,
      padding: 20,
    });
  });

  it("ignores malformed persisted rect and uses default", () => {
    localStorage.setItem(MINI_RECT_STORAGE_KEY, "not-json{");
    const { result } = renderHook(() => usePlayerSession(), { wrapper });
    expect(result.current.miniRect.corner).toBe("bottom-right");
  });

  it("updateMiniRect merges, persists, and (while not minimized) does NOT fire IPC", () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });
    act(() => {
      result.current.updateMiniRect({ corner: "top-left" });
    });
    expect(result.current.miniRect.corner).toBe("top-left");
    // Other fields stay at defaults.
    expect(result.current.miniRect.width).toBe(360);
    // Persisted to localStorage.
    const raw = localStorage.getItem(MINI_RECT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).corner).toBe("top-left");
    // No IPC because we are not in minimize mode.
    expect(playerService.playerEnterMinimize).not.toHaveBeenCalled();
  });

  it("updateMiniRect fires playerEnterMinimize with new rect when already minimized", async () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });
    await act(async () => {
      result.current.minimize();
      await Promise.resolve();
    });
    expect(result.current.isMinimized).toBe(true);
    expect(playerService.playerEnterMinimize).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.updateMiniRect({ corner: "top-right", width: 480 });
      await Promise.resolve();
    });
    // First call from minimize(), second from updateMiniRect.
    expect(playerService.playerEnterMinimize).toHaveBeenCalledTimes(2);
    expect(playerService.playerEnterMinimize).toHaveBeenLastCalledWith(
      480,
      200,
      16,
      "top-right",
    );
  });

  it("updateMiniRect is a no-op when nothing changed", () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });
    const before = result.current.miniRect;
    act(() => {
      result.current.updateMiniRect({ corner: before.corner, width: before.width });
    });
    expect(result.current.miniRect).toBe(before);
    // No localStorage write either.
    expect(localStorage.getItem(MINI_RECT_STORAGE_KEY)).toBeNull();
  });

  it("minimize() reads the latest miniRect (not stale closure)", async () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });
    act(() => {
      result.current.updateMiniRect({
        corner: "top-left",
        width: 480,
        height: 270,
      });
    });
    await act(async () => {
      result.current.minimize();
      await Promise.resolve();
    });
    expect(playerService.playerEnterMinimize).toHaveBeenCalledWith(
      480,
      270,
      16,
      "top-left",
    );
  });
});
