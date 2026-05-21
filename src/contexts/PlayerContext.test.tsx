import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { PlayerProvider, usePlayerSession } from "./PlayerContext";
import * as playerService from "../services/player";

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

  it("minimize() invokes playerEnterMinimize with default size + padding and flips isMinimized", async () => {
    const { result } = renderHook(() => usePlayerSession(), { wrapper });

    await act(async () => {
      result.current.minimize();
      // Let the resolved promise tick so .then(setIsMinimized(true)) runs.
      await Promise.resolve();
    });

    expect(playerService.playerEnterMinimize).toHaveBeenCalledTimes(1);
    expect(playerService.playerEnterMinimize).toHaveBeenCalledWith(360, 200, 16);
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
