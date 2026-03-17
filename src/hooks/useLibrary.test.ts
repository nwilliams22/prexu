import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useLibrary } from "./useLibrary";

const stableServer = { uri: "https://plex.test", accessToken: "token", name: "Test", clientIdentifier: "cid" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: stableServer }),
}));

const mockCacheGet = vi.fn(() => null);
const mockCacheSet = vi.fn();
vi.mock("../services/api-cache", () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
}));

const mockGetLibrarySections = vi.fn();
vi.mock("../services/plex-library", () => ({
  getLibrarySections: (...args: unknown[]) => mockGetLibrarySections(...args),
}));

const fakeSections = [
  { key: "1", title: "Movies", type: "movie", agent: "a", scanner: "s", thumb: "", art: "", updatedAt: 0 },
  { key: "2", title: "TV Shows", type: "show", agent: "a", scanner: "s", thumb: "", art: "", updatedAt: 0 },
];

describe("useLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockGetLibrarySections.mockResolvedValue(fakeSections);
  });

  it("fetches library sections on mount", async () => {
    const { result } = renderHook(() => useLibrary());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetLibrarySections).toHaveBeenCalledWith("https://plex.test", "token");
    expect(result.current.sections).toEqual(fakeSections);
    expect(result.current.error).toBeNull();
  });

  it("starts in loading state when no cache", () => {
    mockGetLibrarySections.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useLibrary());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.sections).toEqual([]);
  });

  it("returns cached data immediately and is not loading", () => {
    mockCacheGet.mockReturnValue(fakeSections);
    mockGetLibrarySections.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useLibrary());

    expect(result.current.sections).toEqual(fakeSections);
    expect(result.current.isLoading).toBe(false);
  });

  it("caches fetched sections", async () => {
    const { result } = renderHook(() => useLibrary());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockCacheSet).toHaveBeenCalledWith(
      expect.stringContaining("library-sections:"),
      fakeSections,
      expect.any(Number),
      true
    );
  });

  it("sets error on fetch failure when no cached data", async () => {
    mockGetLibrarySections.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useLibrary());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Network error");
    expect(result.current.sections).toEqual([]);
  });

  it("does not set error on fetch failure when cached data exists", async () => {
    mockCacheGet.mockReturnValue(fakeSections);
    mockGetLibrarySections.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useLibrary());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.sections).toEqual(fakeSections);
  });

  it("uses generic error message for non-Error throws", async () => {
    mockGetLibrarySections.mockRejectedValue("string error");

    const { result } = renderHook(() => useLibrary());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load libraries");
  });
});
