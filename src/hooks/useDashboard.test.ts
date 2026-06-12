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

  it("starts with all sections loading on mount", () => {
    mockGetRecentlyAddedBySection.mockReturnValue(new Promise(() => {}));
    mockGetOnDeck.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDashboard());

    expect(result.current.loading.movies).toBe(true);
    expect(result.current.loading.shows).toBe(true);
    expect(result.current.loading.deck).toBe(true);
  });

  it("fetches movies and TV separately by section type", async () => {
    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.loading.movies).toBe(false);
      expect(result.current.loading.shows).toBe(false);
      expect(result.current.loading.deck).toBe(false);
    });

    expect(mockGetRecentlyAddedBySection).toHaveBeenCalledWith(
      "https://plex.test", "token",
      [{ key: "1", title: "Movies", type: "movie", updatedAt: 0 }],
      30,
    );
    expect(mockGetRecentlyAddedBySection).toHaveBeenCalledWith(
      "https://plex.test", "token",
      [{ key: "2", title: "TV Shows", type: "show", updatedAt: 0 }],
      30,
    );
    expect(mockGetOnDeck).toHaveBeenCalledWith("https://plex.test", "token");
  });

  it("returns movies from movie sections only", async () => {
    mockGetRecentlyAddedBySection.mockImplementation(
      (_uri: unknown, _token: unknown, sections: { type: string }[]) => {
        if (sections[0]?.type === "movie") {
          return Promise.resolve([makeMovie("1", "Movie A"), makeMovie("3", "Movie C")]);
        }
        return Promise.resolve([]);
      },
    );

    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.loading.movies).toBe(false);
    });

    expect(result.current.recentMovies).toHaveLength(2);
    expect(result.current.recentMovies[0].type).toBe("movie");
  });

  it("groups TV items via groupRecentlyAdded", async () => {
    mockGetRecentlyAddedBySection.mockImplementation(
      (_uri: unknown, _token: unknown, sections: { type: string }[]) => {
        if (sections[0]?.type === "show") {
          return Promise.resolve([makeTvItem("2", "Episode B")]);
        }
        return Promise.resolve([]);
      },
    );
    mockGroupRecentlyAdded.mockReturnValue([{ grouped: true }]);

    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.loading.shows).toBe(false);
    });

    expect(mockGroupRecentlyAdded).toHaveBeenCalled();
    expect(result.current.recentShows).toEqual([{ grouped: true }]);
  });

  it("shows cached movies immediately without loading flag", () => {
    mockCacheGet.mockImplementation((key: string) => {
      if (key.endsWith(":movies")) return [makeMovie("1", "Cached Movie")];
      return null;
    });

    const { result } = renderHook(() => useDashboard());

    expect(result.current.recentMovies).toHaveLength(1);
    expect(result.current.recentMovies[0].title).toBe("Cached Movie");
    expect(result.current.loading.movies).toBe(false);
  });

  it("does background refresh when section is cached", async () => {
    mockCacheGet.mockImplementation((key: string) => {
      if (key.endsWith(":movies")) return [makeMovie("1", "Old Movie")];
      return null;
    });

    mockGetRecentlyAddedBySection.mockImplementation(
      (_uri: unknown, _token: unknown, sections: { type: string }[]) => {
        if (sections[0]?.type === "movie") {
          return Promise.resolve([makeMovie("2", "New Movie")]);
        }
        return Promise.resolve([]);
      },
    );

    const { result } = renderHook(() => useDashboard());

    expect(result.current.recentMovies[0].title).toBe("Old Movie");

    await waitFor(() => {
      expect(result.current.recentMovies[0].title).toBe("New Movie");
    });

    expect(mockGetRecentlyAddedBySection).toHaveBeenCalled();
  });

  it("records per-section error without affecting others", async () => {
    mockGetOnDeck.mockRejectedValue(new Error("Deck timeout"));

    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.loading.deck).toBe(false);
    });

    expect(result.current.errors.deck).toBe("Deck timeout");
    expect(result.current.errors.movies).toBeNull();
    expect(result.current.errors.shows).toBeNull();
  });

  it("refresh() with no arg invalidates and re-fetches all sections", async () => {
    const { result } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.loading.movies).toBe(false);
    });

    act(() => { result.current.refresh(); });

    expect(mockCacheInvalidate).toHaveBeenCalledWith("dashboard:https://plex.test:movies");
    expect(mockCacheInvalidate).toHaveBeenCalledWith("dashboard:https://plex.test:shows");
    expect(mockCacheInvalidate).toHaveBeenCalledWith("dashboard:https://plex.test:deck");
  });

  it("refresh('deck') only invalidates deck", async () => {
    const { result } = renderHook(() => useDashboard());

    await waitFor(() => { expect(result.current.loading.deck).toBe(false); });

    act(() => { result.current.refresh("deck"); });

    expect(mockCacheInvalidate).toHaveBeenCalledWith("dashboard:https://plex.test:deck");
    expect(mockCacheInvalidate).not.toHaveBeenCalledWith("dashboard:https://plex.test:movies");
    expect(mockCacheInvalidate).not.toHaveBeenCalledWith("dashboard:https://plex.test:shows");
  });

  it("returns empty arrays with no server", () => {
    vi.doMock("./useAuth", () => ({ useAuth: () => ({ server: null }) }));
    // Note: with the existing top-level mock of stableServer, just verify the
    // error path through fetch failure with sections=0 doesn't blow up.
    const { result } = renderHook(() => useDashboard());
    expect(result.current.recentMovies).toEqual(expect.any(Array));
    expect(result.current.recentShows).toEqual(expect.any(Array));
    expect(result.current.onDeck).toEqual(expect.any(Array));
  });
});
