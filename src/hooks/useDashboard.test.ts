import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDashboard } from "./useDashboard";

const stableServer = { uri: "https://plex.test", accessToken: "token" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: stableServer }),
}));

vi.mock("./useServerActivity", () => ({
  useServerActivity: () => ({ completionCounter: 0 }),
}));

const mockGetRecentlyAdded = vi.fn(() => Promise.resolve([]));
const mockGetOnDeck = vi.fn(() => Promise.resolve([]));
vi.mock("../services/plex-library", () => ({
  getRecentlyAdded: (...args: unknown[]) => mockGetRecentlyAdded(...args),
  getOnDeck: (...args: unknown[]) => mockGetOnDeck(...args),
}));

const mockGroupRecentlyAdded = vi.fn((items: unknown[]) => items);
vi.mock("../utils/groupRecentlyAdded", () => ({
  groupRecentlyAdded: (...args: unknown[]) => mockGroupRecentlyAdded(...args),
}));

const mockCacheGet = vi.fn(() => null);
const mockCacheSet = vi.fn();
const mockCacheInvalidate = vi.fn();
vi.mock("../services/api-cache", () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheInvalidate: (...args: unknown[]) => mockCacheInvalidate(...args),
}));

const now = Date.now();

function makeMovie(key: string, title: string) {
  return { ratingKey: key, title, type: "movie", addedAt: now };
}

function makeTvItem(key: string, title: string) {
  return { ratingKey: key, title, type: "episode", addedAt: now };
}

describe("useDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockGetRecentlyAdded.mockResolvedValue([]);
    mockGetOnDeck.mockResolvedValue([]);
    mockGroupRecentlyAdded.mockImplementation((items: unknown[]) => items);
  });

  it("starts loading on mount", () => {
    mockGetRecentlyAdded.mockReturnValue(new Promise(() => {}));
    mockGetOnDeck.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDashboard());

    expect(result.current.isLoading).toBe(true);
  });

  it("fetches recent items and on deck", async () => {
    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetRecentlyAdded).toHaveBeenCalledWith(
      "https://plex.test",
      "token",
      50
    );
    expect(mockGetOnDeck).toHaveBeenCalledWith(
      "https://plex.test",
      "token"
    );
  });

  it("splits items into movies and TV", async () => {
    mockGetRecentlyAdded.mockResolvedValue([
      makeMovie("1", "Movie A"),
      makeTvItem("2", "Episode B"),
      makeMovie("3", "Movie C"),
    ]);

    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.recentMovies).toHaveLength(2);
    expect(result.current.recentMovies[0].type).toBe("movie");
    expect(result.current.recentMovies[1].type).toBe("movie");
  });

  it("groups TV items via groupRecentlyAdded", async () => {
    const tvItems = [makeTvItem("2", "Episode B")];
    mockGetRecentlyAdded.mockResolvedValue(tvItems);
    mockGroupRecentlyAdded.mockReturnValue([{ grouped: true }]);

    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGroupRecentlyAdded).toHaveBeenCalled();
    expect(result.current.recentShows).toEqual([{ grouped: true }]);
  });

  it("shows cached data immediately", () => {
    const cachedData = {
      recentMovies: [makeMovie("1", "Cached Movie")],
      recentShows: [],
      onDeck: [],
    };
    mockCacheGet.mockReturnValue(cachedData);

    const { result } = renderHook(() => useDashboard());

    expect(result.current.recentMovies).toHaveLength(1);
    expect(result.current.recentMovies[0].title).toBe("Cached Movie");
    expect(result.current.isLoading).toBe(false);
  });

  it("does background refresh when cached", async () => {
    const cachedData = {
      recentMovies: [makeMovie("1", "Old Movie")],
      recentShows: [],
      onDeck: [],
    };
    mockCacheGet.mockReturnValue(cachedData);

    mockGetRecentlyAdded.mockResolvedValue([makeMovie("2", "New Movie")]);
    mockGetOnDeck.mockResolvedValue([]);

    const { result } = renderHook(() => useDashboard());

    // Starts with cached data
    expect(result.current.recentMovies[0].title).toBe("Old Movie");

    // Background refresh updates data
    await waitFor(() => {
      expect(result.current.recentMovies[0].title).toBe("New Movie");
    });

    // API was still called for background refresh
    expect(mockGetRecentlyAdded).toHaveBeenCalled();
  });

  it("handles fetch error", async () => {
    mockGetRecentlyAdded.mockRejectedValue(new Error("Server down"));

    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Server down");
  });

  it("refresh invalidates cache", async () => {
    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.refresh();
    });

    expect(mockCacheInvalidate).toHaveBeenCalledWith(
      "dashboard:https://plex.test"
    );
  });

  it("returns empty arrays with no server", async () => {
    const useAuthModule = await import("./useAuth");
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      server: null,
    } as ReturnType<typeof useAuthModule.useAuth>);

    const { result } = renderHook(() => useDashboard());

    expect(result.current.recentMovies).toHaveLength(0);
    expect(result.current.recentShows).toHaveLength(0);
    expect(result.current.onDeck).toHaveLength(0);
    expect(mockGetRecentlyAdded).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("sets isLoading false after fetch", async () => {
    const { result } = renderHook(() => useDashboard());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });
});
