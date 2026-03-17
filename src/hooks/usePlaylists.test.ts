import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePlaylists } from "./usePlaylists";

const stableServer = { uri: "https://plex.test", accessToken: "token", name: "Test", clientIdentifier: "cid" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: stableServer }),
}));

const mockCacheGet = vi.fn(() => null);
const mockCacheSet = vi.fn();
const mockCacheInvalidate = vi.fn();
vi.mock("../services/api-cache", () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheInvalidate: (...args: unknown[]) => mockCacheInvalidate(...args),
}));

const mockGetPlaylists = vi.fn();
vi.mock("../services/plex-library", () => ({
  getPlaylists: (...args: unknown[]) => mockGetPlaylists(...args),
}));

const allPlaylists = [
  { ratingKey: "1", title: "Action Movies", playlistType: "video", leafCount: 5, duration: 1000, smart: false },
  { ratingKey: "2", title: "Music Mix", playlistType: "audio", leafCount: 20, duration: 3000, smart: false },
  { ratingKey: "3", title: "TV Queue", playlistType: "video", leafCount: 3, duration: 500, smart: true },
];

describe("usePlaylists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockGetPlaylists.mockResolvedValue(allPlaylists);
  });

  it("fetches playlists and filters to video only", async () => {
    const { result } = renderHook(() => usePlaylists());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetPlaylists).toHaveBeenCalledWith("https://plex.test", "token");
    expect(result.current.playlists).toHaveLength(2);
    expect(result.current.playlists.every((p) => p.playlistType === "video")).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("starts in loading state", () => {
    mockGetPlaylists.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => usePlaylists());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.playlists).toEqual([]);
  });

  it("returns cached playlists immediately without fetching", () => {
    const cachedVideo = allPlaylists.filter((p) => p.playlistType === "video");
    mockCacheGet.mockReturnValue(cachedVideo);

    const { result } = renderHook(() => usePlaylists());

    expect(result.current.playlists).toEqual(cachedVideo);
    expect(result.current.isLoading).toBe(false);
    expect(mockGetPlaylists).not.toHaveBeenCalled();
  });

  it("caches video playlists after fetch", async () => {
    const { result } = renderHook(() => usePlaylists());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockCacheSet).toHaveBeenCalledWith(
      "playlists:all",
      expect.arrayContaining([expect.objectContaining({ playlistType: "video" })]),
      expect.any(Number)
    );
  });

  it("sets error on fetch failure", async () => {
    mockGetPlaylists.mockRejectedValue(new Error("Server down"));

    const { result } = renderHook(() => usePlaylists());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Server down");
  });

  it("uses generic error for non-Error throws", async () => {
    mockGetPlaylists.mockRejectedValue("oops");

    const { result } = renderHook(() => usePlaylists());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load playlists");
  });

  it("retry invalidates cache and re-fetches", async () => {
    mockGetPlaylists.mockResolvedValue(allPlaylists);

    const { result } = renderHook(() => usePlaylists());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    mockGetPlaylists.mockClear();
    mockGetPlaylists.mockResolvedValue(allPlaylists);

    act(() => {
      result.current.retry();
    });

    expect(mockCacheInvalidate).toHaveBeenCalledWith("playlists:all");

    await waitFor(() => {
      expect(mockGetPlaylists).toHaveBeenCalled();
    });
  });
});
