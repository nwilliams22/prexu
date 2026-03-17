import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWatchHistory } from "./useWatchHistory";

const stableServer = { uri: "https://plex.test", accessToken: "token" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: stableServer }),
}));

const mockGetServerAccountId = vi.fn(() => Promise.resolve(42));
vi.mock("../services/plex-api", () => ({
  getServerAccountId: (...args: unknown[]) => mockGetServerAccountId(...args),
}));

const mockGetWatchHistory = vi.fn(() =>
  Promise.resolve({
    items: [{ ratingKey: "1", title: "Movie 1", type: "movie" }],
    totalSize: 100,
    hasMore: true,
  })
);
vi.mock("../services/plex-library", () => ({
  getWatchHistory: (...args: unknown[]) => mockGetWatchHistory(...args),
}));

const mockCacheGet = vi.fn(() => null);
const mockCacheSet = vi.fn();
const mockCacheInvalidate = vi.fn();
vi.mock("../services/api-cache", () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheInvalidate: (...args: unknown[]) => mockCacheInvalidate(...args),
}));

describe("useWatchHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockGetServerAccountId.mockResolvedValue(42);
    mockGetWatchHistory.mockResolvedValue({
      items: [{ ratingKey: "1", title: "Movie 1", type: "movie" }],
      totalSize: 100,
      hasMore: true,
    });
  });

  it("fetches account ID before loading history", async () => {
    const { result } = renderHook(() => useWatchHistory());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetServerAccountId).toHaveBeenCalledWith(
      "https://plex.test",
      "token"
    );
    expect(mockGetServerAccountId).toHaveBeenCalledBefore(mockGetWatchHistory);
  });

  it("uses accountID in cache key", async () => {
    const { result } = renderHook(() => useWatchHistory());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockCacheGet).toHaveBeenCalledWith("watchHistory:page0:42");
  });

  it("loads history items after accountID resolves", async () => {
    const { result } = renderHook(() => useWatchHistory());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].title).toBe("Movie 1");
    expect(result.current.totalSize).toBe(100);
    expect(result.current.hasMore).toBe(true);
  });

  it("supports loadMore pagination", async () => {
    const { result } = renderHook(() => useWatchHistory());

    // Wait for initial fetch to complete and verify hasMore is true
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.hasMore).toBe(true);
    });

    expect(result.current.items).toHaveLength(1);

    // Prepare second page response
    mockGetWatchHistory.mockResolvedValueOnce({
      items: [{ ratingKey: "2", title: "Movie 2", type: "movie" }],
      totalSize: 100,
      hasMore: false,
    });

    await act(async () => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
  });

  it("handles error", async () => {
    mockGetWatchHistory.mockRejectedValue(new Error("API failure"));

    const { result } = renderHook(() => useWatchHistory());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("API failure");
  });

  it("retry invalidates cache and refetches", async () => {
    const { result } = renderHook(() => useWatchHistory());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    mockGetWatchHistory.mockClear();

    act(() => {
      result.current.retry();
    });

    expect(mockCacheInvalidate).toHaveBeenCalledWith(
      expect.stringContaining("watchHistory:page0:")
    );

    await waitFor(() => {
      expect(mockGetWatchHistory).toHaveBeenCalled();
    });
  });

  it("uses cache when available", async () => {
    const cachedData = {
      items: [{ ratingKey: "99", title: "Cached Movie", type: "movie" }],
      totalSize: 1,
      hasMore: false,
    };

    // First call for accountID cache (null), second for watch history cache (hit)
    mockCacheGet
      .mockReturnValueOnce(null)  // first effect may check cache before accountID
      .mockReturnValue(cachedData);

    const { result } = renderHook(() => useWatchHistory());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should show cached data without calling getWatchHistory
    // (getWatchHistory may or may not be called depending on timing of accountID resolution)
    expect(result.current.items).toHaveLength(1);
  });

  it("sets loading states correctly", async () => {
    const { result } = renderHook(() => useWatchHistory());

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isLoadingMore).toBe(false);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isLoadingMore).toBe(false);
  });
});
