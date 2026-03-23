import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Stable reference to prevent infinite re-render loops
const stableServer = { uri: "https://plex.test", accessToken: "token" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({
    server: stableServer,
  }),
}));

const mockCacheGet = vi.fn(() => null);
const mockCacheSet = vi.fn();
vi.mock("../services/api-cache", () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
}));

const mockGetFilterOptions = vi.fn();
vi.mock("../services/plex-library", () => ({
  getFilterOptions: (...args: unknown[]) => mockGetFilterOptions(...args),
}));

import { useFilterOptions } from "./useFilterOptions";

describe("useFilterOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockGetFilterOptions.mockResolvedValue([
      { key: "action", title: "Action" },
    ]);
  });

  it("returns empty arrays when no sectionId", () => {
    const { result } = renderHook(() => useFilterOptions(undefined));

    expect(result.current.genres).toEqual([]);
    expect(result.current.years).toEqual([]);
    expect(result.current.contentRatings).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("fetches all three filter types on mount", async () => {
    renderHook(() => useFilterOptions("1"));

    await waitFor(() => {
      expect(mockGetFilterOptions).toHaveBeenCalledTimes(4);
    });

    expect(mockGetFilterOptions).toHaveBeenCalledWith(
      "https://plex.test", "token", "1", "genre"
    );
    expect(mockGetFilterOptions).toHaveBeenCalledWith(
      "https://plex.test", "token", "1", "year"
    );
    expect(mockGetFilterOptions).toHaveBeenCalledWith(
      "https://plex.test", "token", "1", "contentRating"
    );
    expect(mockGetFilterOptions).toHaveBeenCalledWith(
      "https://plex.test", "token", "1", "resolution"
    );
  });

  it("uses cached data when available", async () => {
    const cachedData = {
      genres: [{ key: "comedy", title: "Comedy" }],
      years: [{ key: "2024", title: "2024" }],
      contentRatings: [{ key: "pg", title: "PG" }],
    };
    mockCacheGet.mockReturnValue(cachedData);

    const { result } = renderHook(() => useFilterOptions("1"));

    expect(result.current.genres).toEqual(cachedData.genres);
    expect(result.current.years).toEqual(cachedData.years);
    expect(result.current.contentRatings).toEqual(cachedData.contentRatings);
    expect(mockGetFilterOptions).not.toHaveBeenCalled();
  });

  it("caches fetched data", async () => {
    const genres = [{ key: "action", title: "Action" }];
    const years = [{ key: "2024", title: "2024" }];
    const ratings = [{ key: "pg", title: "PG" }];
    const resolutions = [{ key: "1080", title: "1080p" }];
    mockGetFilterOptions.mockImplementation(
      (_uri: string, _token: string, _id: string, type: string) => {
        if (type === "genre") return Promise.resolve(genres);
        if (type === "year") return Promise.resolve(years);
        if (type === "contentRating") return Promise.resolve(ratings);
        return Promise.resolve(resolutions);
      }
    );

    renderHook(() => useFilterOptions("1"));

    await waitFor(() => {
      expect(mockCacheSet).toHaveBeenCalledTimes(1);
    });

    const lastCall = mockCacheSet.mock.calls[0];
    expect(lastCall[0]).toBe("filterOptions:1");
    expect(lastCall[1]).toEqual({ genres, years, contentRatings: ratings, resolutions });
    expect(lastCall[2]).toBe(10 * 60 * 1000);
  });

  it("sets isLoading during fetch", async () => {
    // Use slow-resolving mocks so we can observe the loading state
    const resolvers: Array<(val: unknown[]) => void> = [];
    mockGetFilterOptions.mockImplementation(
      () => new Promise((r) => { resolvers.push(r); }),
    );

    const { result } = renderHook(() => useFilterOptions("1"));

    // Wait for the effect to fire and set isLoading = true
    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });

    // Resolve all 4 fetches (genres, years, contentRatings, resolutions) and wait for loading to finish
    await act(async () => {
      resolvers.forEach((r) => r([{ key: "a", title: "A" }]));
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("handles fetch error gracefully", async () => {
    mockGetFilterOptions.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useFilterOptions("1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should still have empty arrays, not crash
    expect(result.current.genres).toEqual([]);
    expect(result.current.years).toEqual([]);
    expect(result.current.contentRatings).toEqual([]);
  });
});
