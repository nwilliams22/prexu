import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDashboard } from "./useDashboard";

const stableServer = { uri: "https://plex.test", accessToken: "token" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: stableServer }),
}));

vi.mock("./useLibrary", () => ({
  useLibrary: () => ({
    sections: [
      { key: "1", title: "Movies", type: "movie", updatedAt: 0 },
      { key: "2", title: "TV Shows", type: "show", updatedAt: 0 },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("./useServerActivity", () => ({
  useServerActivity: () => ({ completionCounter: 0 }),
}));

const mockGetRecentlyAddedBySection = vi.fn(() => Promise.resolve([]));
const mockGetOnDeck = vi.fn(() => Promise.resolve([]));
vi.mock("../services/plex-library", () => ({
  getRecentlyAddedBySection: (...args: unknown[]) => mockGetRecentlyAddedBySection(...args),
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
    mockGetRecentlyAddedBySection.mockResolvedValue([]);
    mockGetOnDeck.mockResolvedValue([]);
    mockGroupRecentlyAdded.mockImplementation((items: unknown[]) => items);
  });

  it("starts loading on mount", () => {
    mockGetRecentlyAddedBySection.mockReturnValue(new Promise(() => {}));
    mockGetOnDeck.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDashboard());

    expect(result.current.isLoading).toBe(true);
  });

  it("fetches movies and TV separately", async () => {
    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should be called at least twice: once for movie sections, once for TV sections
    // (may be called more due to background refresh)
    expect(mockGetRecentlyAddedBySection.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockGetRecentlyAddedBySection).toHaveBeenCalledWith(
      "https://plex.test",
      "token",
      [{ key: "1", title: "Movies", type: "movie", updatedAt: 0 }],
      30
    );
    expect(mockGetRecentlyAddedBySection).toHaveBeenCalledWith(
      "https://plex.test",
      "token",
      [{ key: "2", title: "TV Shows", type: "show", updatedAt: 0 }],
      30
    );
    expect(mockGetOnDeck).toHaveBeenCalledWith(
      "https://plex.test",
      "token"
    );
  });

  it("returns movies from movie sections", async () => {
    mockGetRecentlyAddedBySection.mockImplementation(
      (_uri: unknown, _token: unknown, sections: { type: string }[]) => {
        if (sections[0]?.type === "movie") {
          return Promise.resolve([makeMovie("1", "Movie A"), makeMovie("3", "Movie C")]);
        }
        return Promise.resolve([]);
      }
    );

    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.recentMovies).toHaveLength(2);
    expect(result.current.recentMovies[0].type).toBe("movie");
    expect(result.current.recentMovies[1].type).toBe("movie");
  });

  it("groups TV items via groupRecentlyAdded", async () => {
    mockGetRecentlyAddedBySection.mockImplementation(
      (_uri: unknown, _token: unknown, sections: { type: string }[]) => {
        if (sections[0]?.type === "show") {
          return Promise.resolve([makeTvItem("2", "Episode B")]);
        }
        return Promise.resolve([]);
      }
    );
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

    mockGetRecentlyAddedBySection.mockImplementation(
      (_uri: unknown, _token: unknown, sections: { type: string }[]) => {
        if (sections[0]?.type === "movie") {
          return Promise.resolve([makeMovie("2", "New Movie")]);
        }
        return Promise.resolve([]);
      }
    );
    mockGetOnDeck.mockResolvedValue([]);

    const { result } = renderHook(() => useDashboard());

    // Starts with cached data
    expect(result.current.recentMovies[0].title).toBe("Old Movie");

    // Background refresh updates data
    await waitFor(() => {
      expect(result.current.recentMovies[0].title).toBe("New Movie");
    });

    // API was still called for background refresh
    expect(mockGetRecentlyAddedBySection).toHaveBeenCalled();
  });

  it("handles fetch error", async () => {
    mockGetRecentlyAddedBySection.mockRejectedValue(new Error("Server down"));

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
    expect(mockGetRecentlyAddedBySection).not.toHaveBeenCalled();

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
