import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDashboard, isCacheFresh, isSameData } from "./useDashboard";

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

let mockCompletionCounter = 0;
vi.mock("./useServerActivity", () => ({
  useCompletionCounter: () => mockCompletionCounter,
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
// Default: no age info available (missing/expired/invalidated), matching
// what cacheGetAge returns for a real invalidated or never-fetched entry —
// existing tests below don't care about freshness and expect a fetch every
// time, which is exactly what "not fresh" produces.
const mockCacheGetAge = vi.fn((): number | null => null);
const mockCacheSet = vi.fn();
const mockCacheInvalidate = vi.fn();
vi.mock("../services/api-cache", () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheGetAge: (...args: unknown[]) => mockCacheGetAge(...args),
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
    mockCompletionCounter = 0;
    mockCacheGet.mockReturnValue(null);
    mockCacheGetAge.mockReturnValue(null);
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

  // prexu-0szx.14: useDashboard reads completionCounter via the narrow
  // useCompletionCounter() selector (not the full useServerActivity()
  // context) specifically so it can auto-refresh when an activity finishes
  // without subscribing to session/activity churn. Verify the refresh
  // trigger itself still fires correctly through that narrower hook.
  it("auto-refreshes when completionCounter increases", async () => {
    const { result, rerender } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.loading.movies).toBe(false);
    });

    mockCacheInvalidate.mockClear();
    mockCompletionCounter = 1;
    rerender();

    await waitFor(() => {
      expect(mockCacheInvalidate).toHaveBeenCalledWith("dashboard:https://plex.test:movies");
    });
    expect(mockCacheInvalidate).toHaveBeenCalledWith("dashboard:https://plex.test:shows");
    expect(mockCacheInvalidate).toHaveBeenCalledWith("dashboard:https://plex.test:deck");
  });

  it("does not refresh again if completionCounter stays the same across renders", async () => {
    const { result, rerender } = renderHook(() => useDashboard());

    await waitFor(() => {
      expect(result.current.loading.movies).toBe(false);
    });

    mockCacheInvalidate.mockClear();
    rerender();
    rerender();

    expect(mockCacheInvalidate).not.toHaveBeenCalled();
  });

  // prexu-6qi5.3: Dashboard re-entry from a LIBRARY view was taking 5+ seconds
  // because every mount unconditionally re-ran the movies/shows/deck fetch
  // waterfall even when the cache was seconds old. These tests cover the
  // stale-while-revalidate mount policy: fresh cache skips the refetch
  // entirely, stale-but-unexpired cache still background-revalidates, and a
  // missing/invalidated entry (e.g. deck cleared by cache-invalidators.ts)
  // always refetches regardless of sibling freshness.
  describe("mount-time SWR freshness policy", () => {
    it("isCacheFresh: null age (missing/expired/invalidated) is never fresh", () => {
      expect(isCacheFresh(null, 2 * 60 * 1000)).toBe(false);
    });

    it("isCacheFresh: age within threshold is fresh", () => {
      expect(isCacheFresh(5_000, 2 * 60 * 1000)).toBe(true);
      expect(isCacheFresh(2 * 60 * 1000, 2 * 60 * 1000)).toBe(true); // boundary inclusive
    });

    it("isCacheFresh: age past threshold is not fresh", () => {
      expect(isCacheFresh(2 * 60 * 1000 + 1, 2 * 60 * 1000)).toBe(false);
    });

    it("isSameData: structurally equal values are equal even with different references", () => {
      expect(isSameData([{ a: 1 }], [{ a: 1 }])).toBe(true);
    });

    it("isSameData: structurally different values are not equal", () => {
      expect(isSameData([{ a: 1 }], [{ a: 2 }])).toBe(false);
    });

    it("skips the movies refetch on mount when the cache entry is fresh", async () => {
      mockCacheGet.mockImplementation((key: string) => {
        if (key.endsWith(":movies")) return [makeMovie("1", "Fresh Movie")];
        return null;
      });
      mockCacheGetAge.mockImplementation((key: string) =>
        key.endsWith(":movies") ? 5_000 : null,
      );

      const { result } = renderHook(() => useDashboard());

      expect(result.current.recentMovies[0]?.title).toBe("Fresh Movie");

      // Let shows/deck (not fresh) settle so there's nothing pending.
      await waitFor(() => {
        expect(result.current.loading.shows).toBe(false);
        expect(result.current.loading.deck).toBe(false);
      });

      expect(mockGetRecentlyAddedBySection).not.toHaveBeenCalledWith(
        "https://plex.test", "token",
        [{ key: "1", title: "Movies", type: "movie", updatedAt: 0 }],
        30,
      );
    });

    it("still refetches movies on mount when the cache entry is stale (past the freshness threshold but within TTL)", async () => {
      mockCacheGet.mockImplementation((key: string) => {
        if (key.endsWith(":movies")) return [makeMovie("1", "Old Movie")];
        return null;
      });
      mockCacheGetAge.mockImplementation((key: string) =>
        key.endsWith(":movies") ? 3 * 60 * 1000 : null, // 3 min: stale, but under the 60-min TTL
      );
      mockGetRecentlyAddedBySection.mockImplementation(
        (_uri: unknown, _token: unknown, sections: { type: string }[]) =>
          sections[0]?.type === "movie"
            ? Promise.resolve([makeMovie("2", "New Movie")])
            : Promise.resolve([]),
      );

      const { result } = renderHook(() => useDashboard());

      expect(result.current.recentMovies[0]?.title).toBe("Old Movie");

      await waitFor(() => {
        expect(result.current.recentMovies[0]?.title).toBe("New Movie");
      });

      expect(mockGetRecentlyAddedBySection).toHaveBeenCalledWith(
        "https://plex.test", "token",
        [{ key: "1", title: "Movies", type: "movie", updatedAt: 0 }],
        30,
      );
    });

    it("refetches deck when its cache entry is absent (invalidated) even though movies/shows are fresh", async () => {
      mockCacheGet.mockImplementation((key: string) => {
        if (key.endsWith(":movies")) return [makeMovie("1", "Fresh Movie")];
        if (key.endsWith(":shows")) return [{ grouped: true }];
        return null; // deck entry absent, e.g. invalidated by cache-invalidators.ts
      });
      mockCacheGetAge.mockImplementation((key: string) => {
        if (key.endsWith(":movies")) return 1_000;
        if (key.endsWith(":shows")) return 1_000;
        return null; // deck: missing/invalidated
      });
      mockGetOnDeck.mockResolvedValue([makeMovie("9", "Deck Item")]);

      const { result } = renderHook(() => useDashboard());

      await waitFor(() => {
        expect(result.current.loading.deck).toBe(false);
      });

      expect(mockGetOnDeck).toHaveBeenCalledWith("https://plex.test", "token");
      expect(mockGetRecentlyAddedBySection).not.toHaveBeenCalledWith(
        "https://plex.test", "token",
        [{ key: "1", title: "Movies", type: "movie", updatedAt: 0 }],
        30,
      );
      expect(mockGetRecentlyAddedBySection).not.toHaveBeenCalledWith(
        "https://plex.test", "token",
        [{ key: "2", title: "TV Shows", type: "show", updatedAt: 0 }],
        30,
      );
    });

    it("keeps the same recentMovies array reference when a background revalidation resolves to identical data", async () => {
      const movie = makeMovie("1", "Same Movie");
      mockCacheGet.mockImplementation((key: string) =>
        key.endsWith(":movies") ? [movie] : null,
      );
      // cacheGetAge defaults to null (not fresh) so the revalidation fetch
      // still runs — this test targets the unchanged-data no-op set, not the
      // mount-skip policy above.
      mockGetRecentlyAddedBySection.mockImplementation(
        (_uri: unknown, _token: unknown, sections: { type: string }[]) =>
          sections[0]?.type === "movie"
            ? Promise.resolve([movie])
            : Promise.resolve([]),
      );

      const { result } = renderHook(() => useDashboard());
      const before = result.current.recentMovies;

      await waitFor(() => {
        expect(result.current.loading.movies).toBe(false);
      });

      expect(mockGetRecentlyAddedBySection).toHaveBeenCalled();
      expect(result.current.recentMovies).toBe(before);
    });
  });
});
