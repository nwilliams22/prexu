import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePopOutPlayer } from "./usePopOutPlayer";
import * as playerService from "../../services/player";

vi.mock("../../services/player", () => ({
  playerEnterPopOut: vi.fn().mockResolvedValue(undefined),
  playerExitPopOut: vi.fn().mockResolvedValue(undefined),
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

// SUPPORTS_PLAYER_WINDOWING resolves from navigator.userAgent + Tauri
// internals, both absent by default under jsdom — so pop-out would report
// unsupported here without this override. All the existing tests in this
// file assume Windows-native pop-out IPC works; the "windowing
// unsupported" describe block below covers the Linux-native gate
// (prexu-axj4.4) with its own per-test remock instead.
vi.mock("./engineResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./engineResolution")>()),
  SUPPORTS_PLAYER_WINDOWING: true,
}));

describe("usePopOutPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with isPopOut=false and reports support=true", () => {
    const { result } = renderHook(() => usePopOutPlayer());
    expect(result.current.isPopOut).toBe(false);
    expect(result.current.isPopOutSupported).toBe(true);
  });

  it("calls playerEnterPopOut with no args on first toggle (Rust uses persisted geometry)", async () => {
    const { result } = renderHook(() => usePopOutPlayer());

    await act(async () => {
      result.current.togglePopOut();
      // Let the resolved promise tick so the .then(setIsPopOut(true)) runs.
      await Promise.resolve();
    });

    expect(playerService.playerEnterPopOut).toHaveBeenCalledTimes(1);
    expect(playerService.playerEnterPopOut).toHaveBeenCalledWith();
    expect(result.current.isPopOut).toBe(true);
  });

  it("calls playerExitPopOut on second toggle and clears isPopOut", async () => {
    const { result, rerender } = renderHook(() => usePopOutPlayer());

    await act(async () => {
      result.current.togglePopOut();
      await Promise.resolve();
    });
    rerender();
    expect(result.current.isPopOut).toBe(true);

    await act(async () => {
      result.current.togglePopOut();
      await Promise.resolve();
    });

    expect(playerService.playerExitPopOut).toHaveBeenCalledTimes(1);
    expect(result.current.isPopOut).toBe(false);
  });

  it("does not flip isPopOut when the underlying invoke rejects on enter", async () => {
    vi.mocked(playerService.playerEnterPopOut).mockRejectedValueOnce(
      new Error("rust failure"),
    );
    const { result } = renderHook(() => usePopOutPlayer());

    await act(async () => {
      result.current.togglePopOut();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isPopOut).toBe(false);
  });
});

describe("usePopOutPlayer — windowing unsupported (e.g. Linux native, prexu-axj4.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports isPopOutSupported=false and no-ops togglePopOut without invoking IPC", async () => {
    vi.resetModules();
    vi.doMock("./engineResolution", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./engineResolution")>()),
      SUPPORTS_PLAYER_WINDOWING: false,
    }));

    const { usePopOutPlayer: usePopOutPlayerUnsupported } = await import("./usePopOutPlayer");
    const { result } = renderHook(() => usePopOutPlayerUnsupported());

    expect(result.current.isPopOutSupported).toBe(false);

    act(() => {
      result.current.togglePopOut();
    });

    expect(playerService.playerEnterPopOut).not.toHaveBeenCalled();
    expect(playerService.playerExitPopOut).not.toHaveBeenCalled();
    expect(result.current.isPopOut).toBe(false);
  });
});
