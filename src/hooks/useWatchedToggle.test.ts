import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWatchedToggle } from "./useWatchedToggle";

const mockMarkAsWatched = vi.fn();
const mockMarkAsUnwatched = vi.fn();

vi.mock("../services/plex-library", () => ({
  markAsWatched: (...args: unknown[]) => mockMarkAsWatched(...args),
  markAsUnwatched: (...args: unknown[]) => mockMarkAsUnwatched(...args),
}));

vi.mock("./useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://plex.test", accessToken: "token" },
  }),
}));

describe("useWatchedToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkAsWatched.mockResolvedValue(undefined);
    mockMarkAsUnwatched.mockResolvedValue(undefined);
  });

  it("calls markAsWatched when toggling unwatched item", async () => {
    const { result } = renderHook(() => useWatchedToggle());

    let newState: boolean | undefined;
    await act(async () => {
      newState = await result.current.toggle("123", false);
    });

    expect(mockMarkAsWatched).toHaveBeenCalledWith("https://plex.test", "token", "123");
    expect(newState).toBe(true);
  });

  it("calls markAsUnwatched when toggling watched item", async () => {
    const { result } = renderHook(() => useWatchedToggle());

    let newState: boolean | undefined;
    await act(async () => {
      newState = await result.current.toggle("123", true);
    });

    expect(mockMarkAsUnwatched).toHaveBeenCalledWith("https://plex.test", "token", "123");
    expect(newState).toBe(false);
  });

  it("returns original state on failure (rollback)", async () => {
    mockMarkAsWatched.mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() => useWatchedToggle());

    let newState: boolean | undefined;
    await act(async () => {
      newState = await result.current.toggle("123", false);
    });

    expect(newState).toBe(false); // rolled back
  });

  it("calls onToggled callback on success", async () => {
    const onToggled = vi.fn();
    const { result } = renderHook(() => useWatchedToggle(onToggled));

    await act(async () => {
      await result.current.toggle("123", false);
    });

    expect(onToggled).toHaveBeenCalled();
  });

  it("does not call onToggled on failure", async () => {
    mockMarkAsWatched.mockRejectedValue(new Error("fail"));
    const onToggled = vi.fn();
    const { result } = renderHook(() => useWatchedToggle(onToggled));

    await act(async () => {
      await result.current.toggle("123", false);
    });

    expect(onToggled).not.toHaveBeenCalled();
  });
});
