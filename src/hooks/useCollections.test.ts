import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCollections, useSectionCollections } from "./useCollections";

const DEFAULT_SERVER = { uri: "https://plex.test", accessToken: "token" };
// Mutable holder so a test can swap the active server and assert the cache key
// is scoped per server URI (prexu-9f4s.2).
const authState = vi.hoisted(() => ({
  server: { uri: "https://plex.test", accessToken: "token" },
}));
vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: authState.server }),
}));

const stableSections = [
  { key: "1", title: "Movies", type: "movie" },
  { key: "2", title: "TV", type: "show" },
  { key: "3", title: "Music", type: "artist" },
];
vi.mock("./useLibrary", () => ({
  useLibrary: () => ({
    sections: stableSections,
  }),
}));

const mockCacheGet = vi.fn(() => null);
const mockCacheSet = vi.fn();
const mockCacheInvalidate = vi.fn();
vi.mock("../services/api-cache", () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheInvalidate: (...args: unknown[]) => mockCacheInvalidate(...args),
}));

const mockGetCollections = vi.fn();
const mockGetCollectionItems = vi.fn();
vi.mock("../services/plex-library", () => ({
  getCollections: (...args: unknown[]) => mockGetCollections(...args),
  getCollectionItems: (...args: unknown[]) => mockGetCollectionItems(...args),
}));

function makeCollection(key: string, title: string) {
  return { ratingKey: key, title, type: "collection", thumb: "" };
}

describe("useCollections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.server = { ...DEFAULT_SERVER };
    mockCacheGet.mockReturnValue(null);
    mockGetCollections.mockResolvedValue([]);
  });

  it("only fetches from movie and show sections (not music)", async () => {
    mockGetCollections.mockResolvedValue([makeCollection("c1", "Action")]);

    const { result } = renderHook(() => useCollections());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Called for movie (key=1) and show (key=2) but not music (key=3)
    expect(mockGetCollections).toHaveBeenCalledTimes(2);
    expect(mockGetCollections).toHaveBeenCalledWith(
      "https://plex.test",
      "token",
      "1"
    );
    expect(mockGetCollections).toHaveBeenCalledWith(
      "https://plex.test",
      "token",
      "2"
    );
  });

  it("filters out sections with empty collections", async () => {
    mockGetCollections
      .mockResolvedValueOnce([makeCollection("c1", "Action")])
      .mockResolvedValueOnce([]);

    const { result } = renderHook(() => useCollections());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.collections).toHaveLength(1);
    expect(result.current.collections[0].section.key).toBe("1");
  });

  it("caches results", async () => {
    mockGetCollections.mockResolvedValue([makeCollection("c1", "Action")]);

    const { result } = renderHook(() => useCollections());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockCacheSet).toHaveBeenCalledWith(
      "collections:https://plex.test:all",
      expect.any(Array),
      expect.any(Number)
    );
  });

  it("scopes the cache key by server URI so a different server is never served stale data", async () => {
    authState.server = { uri: "https://server-a.test", accessToken: "ta" };
    mockGetCollections.mockResolvedValue([makeCollection("c1", "Action")]);
    const { result, unmount } = renderHook(() => useCollections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const keyA = mockCacheGet.mock.calls[0]?.[0];
    unmount();
    mockCacheGet.mockClear();
    mockCacheGet.mockReturnValue(null);

    authState.server = { uri: "https://server-b.test", accessToken: "tb" };
    const { result: resultB } = renderHook(() => useCollections());
    await waitFor(() => expect(resultB.current.isLoading).toBe(false));
    const keyB = mockCacheGet.mock.calls[0]?.[0];

    expect(keyA).toBe("collections:https://server-a.test:all");
    expect(keyB).toBe("collections:https://server-b.test:all");
    expect(keyA).not.toBe(keyB);
  });

  it("handles per-section failure gracefully", async () => {
    mockGetCollections
      .mockRejectedValueOnce(new Error("Server error"))
      .mockResolvedValueOnce([makeCollection("c2", "Drama")]);

    const { result } = renderHook(() => useCollections());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Failed section returns empty items, gets filtered; successful section remains
    expect(result.current.collections).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("starts loading, then finishes", async () => {
    mockGetCollections.mockResolvedValue([]);

    const { result } = renderHook(() => useCollections());

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });
});

describe("useSectionCollections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockGetCollections.mockResolvedValue([]);
    mockGetCollectionItems.mockResolvedValue({ items: [] });
  });

  it("returns empty when sectionId undefined", () => {
    const { result } = renderHook(() => useSectionCollections(undefined));

    expect(result.current.collections).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
    expect(mockGetCollections).not.toHaveBeenCalled();
  });

  it("fetches collections for section", async () => {
    const colls = [makeCollection("c1", "Action"), makeCollection("c2", "Comedy")];
    mockGetCollections.mockResolvedValue(colls);

    const { result } = renderHook(() => useSectionCollections("1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetCollections).toHaveBeenCalledWith(
      "https://plex.test",
      "token",
      "1"
    );
    expect(result.current.collections).toEqual(colls);
  });

  it("computes watched map correctly", async () => {
    const colls = [makeCollection("c1", "Action")];
    mockGetCollections.mockResolvedValue(colls);
    mockGetCollectionItems.mockResolvedValue({
      items: [
        { ratingKey: "m1", viewCount: 1 },
        { ratingKey: "m2", viewCount: 2 },
      ],
    });

    const { result } = renderHook(() => useSectionCollections("1"));

    await waitFor(() => {
      expect(result.current.watchedMap).toHaveProperty("c1");
    });

    // All items have viewCount > 0, so collection is fully watched
    expect(result.current.watchedMap["c1"]).toBe(true);
  });

  it("resolves watched status from leafCount/viewedLeafCount aggregates without fetching children (prexu-0szx.18)", async () => {
    const colls = [
      { ...makeCollection("c1", "Fully Watched"), leafCount: 5, viewedLeafCount: 5 },
      { ...makeCollection("c2", "Partially Watched"), leafCount: 5, viewedLeafCount: 2 },
    ];
    mockGetCollections.mockResolvedValue(colls);

    const { result } = renderHook(() => useSectionCollections("1"));

    await waitFor(() => {
      expect(result.current.watchedMap).toHaveProperty("c1");
      expect(result.current.watchedMap).toHaveProperty("c2");
    });

    expect(result.current.watchedMap["c1"]).toBe(true);
    expect(result.current.watchedMap["c2"]).toBe(false);
    // No per-collection children fetch was needed — resolved from aggregates alone.
    expect(mockGetCollectionItems).not.toHaveBeenCalled();
  });

  it("falls back to fetching children only for collections missing aggregates", async () => {
    const withAggregates = { ...makeCollection("c1", "Has Aggregates"), leafCount: 3, viewedLeafCount: 3 };
    const withoutAggregates = makeCollection("c2", "No Aggregates");
    mockGetCollections.mockResolvedValue([withAggregates, withoutAggregates]);
    mockGetCollectionItems.mockResolvedValue({
      items: [{ ratingKey: "m1", viewCount: 1 }],
    });

    const { result } = renderHook(() => useSectionCollections("1"));

    await waitFor(() => {
      expect(result.current.watchedMap).toHaveProperty("c2");
    });

    expect(result.current.watchedMap["c1"]).toBe(true);
    expect(result.current.watchedMap["c2"]).toBe(true);
    // Only the collection lacking aggregates triggered a children fetch.
    expect(mockGetCollectionItems).toHaveBeenCalledTimes(1);
    expect(mockGetCollectionItems).toHaveBeenCalledWith("https://plex.test", "token", "c2");
  });

  it("uses cache when available", () => {
    const colls = [makeCollection("c1", "Action")];
    const watchedMap = { c1: true };
    mockCacheGet
      .mockReturnValueOnce(colls)      // collections cache
      .mockReturnValueOnce(watchedMap); // watched cache

    const { result } = renderHook(() => useSectionCollections("1"));

    expect(result.current.collections).toEqual(colls);
    expect(result.current.watchedMap).toEqual(watchedMap);
    expect(result.current.isLoading).toBe(false);
    expect(mockGetCollections).not.toHaveBeenCalled();
  });

  it("retry invalidates both collection and watched caches", async () => {
    mockGetCollections.mockResolvedValue([]);

    const { result } = renderHook(() => useSectionCollections("1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.retry();
    });

    expect(mockCacheInvalidate).toHaveBeenCalledWith("collections:section:1");
    expect(mockCacheInvalidate).toHaveBeenCalledWith("collections:watched:1");
  });
});
