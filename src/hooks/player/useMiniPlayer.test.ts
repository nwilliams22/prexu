import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMiniPlayer } from "./useMiniPlayer";
import * as playerService from "../../services/player";

vi.mock("../../services/player", () => ({
  playerEnterMini: vi.fn().mockResolvedValue(undefined),
  playerExitMini: vi.fn().mockResolvedValue(undefined),
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

describe("useMiniPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with isMini=false and reports support=true", () => {
    const { result } = renderHook(() => useMiniPlayer());
    expect(result.current.isMini).toBe(false);
    expect(result.current.isMiniSupported).toBe(true);
  });

  it("calls playerEnterMini with default geometry on first toggle", async () => {
    const { result } = renderHook(() => useMiniPlayer());

    await act(async () => {
      result.current.toggleMini();
      // Let the resolved promise tick so the .then(setIsMini(true)) runs.
      await Promise.resolve();
    });

    expect(playerService.playerEnterMini).toHaveBeenCalledTimes(1);
    expect(playerService.playerEnterMini).toHaveBeenCalledWith(
      "bottom-right",
      480,
      270,
    );
    expect(result.current.isMini).toBe(true);
  });

  it("calls playerExitMini on second toggle and clears isMini", async () => {
    const { result, rerender } = renderHook(() => useMiniPlayer());

    await act(async () => {
      result.current.toggleMini();
      await Promise.resolve();
    });
    rerender();
    expect(result.current.isMini).toBe(true);

    await act(async () => {
      result.current.toggleMini();
      await Promise.resolve();
    });

    expect(playerService.playerExitMini).toHaveBeenCalledTimes(1);
    expect(result.current.isMini).toBe(false);
  });

  it("does not flip isMini when the underlying invoke rejects on enter", async () => {
    vi.mocked(playerService.playerEnterMini).mockRejectedValueOnce(
      new Error("rust failure"),
    );
    const { result } = renderHook(() => useMiniPlayer());

    await act(async () => {
      result.current.toggleMini();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isMini).toBe(false);
  });
});
