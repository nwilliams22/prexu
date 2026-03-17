import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let mockQuery = "";
// Cache URLSearchParams instances to avoid creating new objects on every render,
// which causes excessive memory consumption in jsdom.
let cachedQuery = "";
let cachedParams = new URLSearchParams("");
vi.mock("react-router-dom", () => ({
  useSearchParams: () => {
    const q = mockQuery ? `q=${mockQuery}` : "";
    if (q !== cachedQuery) {
      cachedQuery = q;
      cachedParams = new URLSearchParams(q);
    }
    return [cachedParams];
  },
}));

// Stable reference to avoid infinite useEffect re-triggers
const mockServer = { uri: "https://plex.test", accessToken: "token" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: mockServer }),
}));

const mockSearchLibrary = vi.fn();
vi.mock("../services/plex-library", () => ({
  searchLibrary: (...args: unknown[]) => mockSearchLibrary(...args),
}));

import { useSearch } from "./useSearch";

describe("useSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchLibrary.mockReset();
    mockSearchLibrary.mockResolvedValue([]);
    mockQuery = "";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results for empty query", () => {
    mockQuery = "";
    const { result } = renderHook(() => useSearch());

    expect(result.current.results).toEqual([]);
    expect(result.current.query).toBe("");
    expect(result.current.isSearching).toBe(false);
  });

  it("calls searchLibrary after 300ms debounce", async () => {
    mockSearchLibrary.mockResolvedValue([
      { hubIdentifier: "1", title: "Movies", Metadata: [{ title: "Test" }] },
    ]);
    mockQuery = "test";

    renderHook(() => useSearch());

    expect(mockSearchLibrary).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(mockSearchLibrary).toHaveBeenCalledWith(
      "https://plex.test",
      "token",
      "test",
      15
    );
  });

  it("filters out empty hubs", async () => {
    mockSearchLibrary.mockResolvedValue([
      { hubIdentifier: "1", title: "Movies", Metadata: [{ title: "Test" }] },
      { hubIdentifier: "2", title: "Empty", Metadata: [] },
      { hubIdentifier: "3", title: "Null", Metadata: null },
    ]);
    mockQuery = "movie";

    const { result } = renderHook(() => useSearch());

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].title).toBe("Movies");
  });

  it("sets error on failure", async () => {
    mockSearchLibrary.mockRejectedValue(new Error("Network error"));
    mockQuery = "fail";

    const { result } = renderHook(() => useSearch());

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.error).toBe("Network error");
    expect(result.current.results).toEqual([]);
  });

  it("returns query from search params", () => {
    mockQuery = "hello";
    const { result } = renderHook(() => useSearch());

    expect(result.current.query).toBe("hello");
  });

  it("sets isSearching while loading", async () => {
    let resolveSearch!: (value: unknown[]) => void;
    mockSearchLibrary.mockImplementation(
      () => new Promise((resolve) => { resolveSearch = resolve; })
    );
    mockQuery = "loading";

    const { result } = renderHook(() => useSearch());

    expect(result.current.isSearching).toBe(true);

    // Advance past debounce to trigger the search call
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Still searching since promise hasn't resolved
    expect(result.current.isSearching).toBe(true);

    // Resolve the search
    await act(async () => {
      resolveSearch([]);
    });

    expect(result.current.isSearching).toBe(false);
  });

  it("clears results on empty query", async () => {
    mockSearchLibrary.mockResolvedValue([
      { hubIdentifier: "1", title: "Movies", Metadata: [{ title: "Test" }] },
    ]);
    mockQuery = "test";

    const { result, rerender } = renderHook(() => useSearch());

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.results).toHaveLength(1);

    // Clear the query
    mockQuery = "";
    rerender();

    expect(result.current.results).toEqual([]);
    expect(result.current.isSearching).toBe(false);
  });

  it("does not re-fetch for same query", async () => {
    mockSearchLibrary.mockResolvedValue([]);
    mockQuery = "same";

    const { rerender } = renderHook(() => useSearch());

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    const callCount = mockSearchLibrary.mock.calls.length;

    // Re-render with same query
    rerender();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Should not have called again beyond the initial calls
    expect(mockSearchLibrary.mock.calls.length).toBe(callCount);
  });
});
