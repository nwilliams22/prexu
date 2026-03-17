import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePaginatedLibrary } from "./usePaginatedLibrary";

const stableServer = { uri: "https://plex.test", accessToken: "token" };
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

const mockGetLibraryItems = vi.fn();
vi.mock("../services/plex-library", () => ({
  getLibraryItems: (...args: unknown[]) => mockGetLibraryItems(...args),
}));

function makeItems(count: number, startIndex = 0) {
  return Array.from({ length: count }, (_, i) => ({
    ratingKey: String(startIndex + i),
    title: `Item ${startIndex + i}`,
    type: "movie",
    addedAt: Date.now(),
  }));
}

describe("usePaginatedLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockGetLibraryItems.mockResolvedValue({
      items: makeItems(50),
      totalSize: 200,
      hasMore: true,
    });
  });

  it("returns cached items instantly when cache hit", async () => {
    const cachedData = {
      items: makeItems(10),
      totalSize: 10,
      hasMore: false,
    };
    mockCacheGet.mockReturnValue(cachedData);

    const { result } = renderHook(() => usePaginatedLibrary("1"));

    expect(result.current.items).toEqual(cachedData.items);
    expect(result.current.totalSize).toBe(10);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(mockGetLibraryItems).not.toHaveBeenCalled();
  });

  it("fetches items on cache miss", async () => {
    const { result } = renderHook(() => usePaginatedLibrary("1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetLibraryItems).toHaveBeenCalledWith(
      "https://plex.test",
      "token",
      "1",
      expect.objectContaining({ start: 0, size: 50 })
    );
    expect(result.current.items).toHaveLength(50);
  });

  it("sets isLoading during initial fetch", () => {
    mockGetLibraryItems.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => usePaginatedLibrary("1"));

    expect(result.current.isLoading).toBe(true);
  });

  it("updates items from API response", async () => {
    const items = makeItems(25);
    mockGetLibraryItems.mockResolvedValue({
      items,
      totalSize: 25,
      hasMore: false,
    });

    const { result } = renderHook(() => usePaginatedLibrary("1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toEqual(items);
    expect(result.current.totalSize).toBe(25);
    expect(result.current.hasMore).toBe(false);
  });

  it("supports loadMore pagination (appends to items)", async () => {
    const { result } = renderHook(() => usePaginatedLibrary("1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Prepare second page
    const secondPage = makeItems(30, 50);
    mockGetLibraryItems.mockResolvedValue({
      items: secondPage,
      totalSize: 200,
      hasMore: true,
    });

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.isLoadingMore).toBe(false);
    });

    expect(result.current.items).toHaveLength(80);
    expect(mockGetLibraryItems).toHaveBeenLastCalledWith(
      "https://plex.test",
      "token",
      "1",
      expect.objectContaining({ start: 50 })
    );
  });

  it("sets hasMore from API response", async () => {
    mockGetLibraryItems.mockResolvedValue({
      items: makeItems(10),
      totalSize: 10,
      hasMore: false,
    });

    const { result } = renderHook(() => usePaginatedLibrary("1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasMore).toBe(false);
  });

  it("stores fetched items in cache", async () => {
    const { result } = renderHook(() => usePaginatedLibrary("1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockCacheSet).toHaveBeenCalledWith(
      expect.stringContaining("library:https://plex.test:1:"),
      expect.objectContaining({ items: expect.any(Array), totalSize: 200 }),
      expect.any(Number)
    );
  });

  it("handles fetch error", async () => {
    mockGetLibraryItems.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => usePaginatedLibrary("1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Network error");
    expect(result.current.items).toHaveLength(0);
  });

  it("retry invalidates cache and refetches", async () => {
    const { result } = renderHook(() => usePaginatedLibrary("1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    mockGetLibraryItems.mockClear();

    act(() => {
      result.current.retry();
    });

    expect(mockCacheInvalidate).toHaveBeenCalled();

    await waitFor(() => {
      expect(mockGetLibraryItems).toHaveBeenCalled();
    });
  });

  it("returns early when no sectionId", () => {
    const { result } = renderHook(() => usePaginatedLibrary(undefined));

    expect(mockGetLibraryItems).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(0);
  });

  it("returns early when no server", async () => {
    // Re-mock useAuth to return no server
    const useAuthModule = await import("./useAuth");
    vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
      server: null,
    } as ReturnType<typeof useAuthModule.useAuth>);

    const { result } = renderHook(() => usePaginatedLibrary("1"));

    expect(mockGetLibraryItems).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(0);

    vi.restoreAllMocks();
  });

  it("loadAll mode fetches progressive batches", async () => {
    const firstPage = makeItems(50, 0);
    const secondBatch = makeItems(50, 50);

    mockGetLibraryItems
      .mockResolvedValueOnce({
        items: firstPage,
        totalSize: 100,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: secondBatch,
        totalSize: 100,
        hasMore: false,
      });

    const { result } = renderHook(() =>
      usePaginatedLibrary("1", "titleSort:asc", {}, { loadAll: true })
    );

    // First page loads quickly
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items.length).toBeGreaterThanOrEqual(50);

    // Background batch completes
    await waitFor(() => {
      expect(result.current.isLoadingMore).toBe(false);
    });

    expect(result.current.items).toHaveLength(100);
    expect(mockGetLibraryItems).toHaveBeenCalledTimes(2);
  });
});
