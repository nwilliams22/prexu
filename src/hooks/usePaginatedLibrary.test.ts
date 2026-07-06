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

/** Deferred-promise mock keyed by the requested `start` offset, so a test
 *  can resolve individual chunk fetches in whatever order it needs. */
function deferredByOffset(total: number) {
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const calls: number[] = [];
  mockGetLibraryItems.mockImplementation(
    (_uri: string, _token: string, _section: string, opts: { start: number; size: number; signal?: AbortSignal }) => {
      calls.push(opts.start);
      return new Promise((resolve, reject) => {
        pending.set(opts.start, { resolve, reject });
        opts.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    },
  );
  return {
    calls,
    resolve(offset: number, count: number) {
      const p = pending.get(offset);
      if (!p) throw new Error(`no pending fetch for offset ${offset}`);
      pending.delete(offset);
      p.resolve({ items: makeItems(count, offset), totalSize: total, hasMore: offset + count < total });
    },
  };
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
      store: makeItems(10),
      totalSize: 10,
    };
    mockCacheGet.mockReturnValue(cachedData);

    const { result } = renderHook(() => usePaginatedLibrary("1"));

    expect(result.current.items).toEqual(cachedData.store);
    expect(result.current.totalSize).toBe(10);
    expect(result.current.isLoading).toBe(false);
    expect(mockGetLibraryItems).not.toHaveBeenCalled();
  });

  it("fetches the first chunk on cache miss", async () => {
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
    expect(result.current.totalSize).toBe(200);
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
  });

  // ── prexu-6qi5.1: range-driven sparse fetching ──

  it("ensureRange fetches a distant chunk (jump-to-bottom) leaving the gap sparse", async () => {
    const total = 2000;
    const d = deferredByOffset(total);

    const { result } = renderHook(() => usePaginatedLibrary("1"));

    // Initial chunk (offset 0) is requested automatically for the fast paint.
    await waitFor(() => expect(d.calls).toContain(0));
    act(() => d.resolve(0, 50));
    await waitFor(() => expect(result.current.totalSize).toBe(total));

    // User flings straight to the bottom — request the last visible range.
    act(() => {
      result.current.ensureRange(1950, 2000);
    });
    await waitFor(() => expect(d.calls).toContain(1950));
    act(() => d.resolve(1950, 50));

    await waitFor(() => {
      expect(result.current.items[1950]?.title).toBe("Item 1950");
    });

    // The store spans the full section length...
    expect(result.current.items).toHaveLength(total);
    // ...but the untouched middle is still sparse (unfetched), not fetched
    // eagerly — that's the whole point of range-driven fetching.
    expect(result.current.items[1000]).toBeUndefined();
    // The originally-loaded prefix is untouched.
    expect(result.current.items[0]?.title).toBe("Item 0");
  });

  it("de-dupes in-flight requests for the same chunk", async () => {
    const total = 2000;
    const d = deferredByOffset(total);

    const { result } = renderHook(() => usePaginatedLibrary("1"));
    await waitFor(() => expect(d.calls).toContain(0));
    act(() => d.resolve(0, 50));
    await waitFor(() => expect(result.current.totalSize).toBe(total));

    d.calls.length = 0;

    // Two overlapping range requests for the same chunk in quick succession —
    // only one network request should be made for offset 500.
    act(() => {
      result.current.ensureRange(500, 520);
      result.current.ensureRange(505, 525);
    });

    await waitFor(() => expect(d.calls.length).toBeGreaterThan(0));
    expect(d.calls.filter((o) => o === 500).length).toBe(1);
  });

  it("aborts a chunk fetch once the user scrolls past its range", async () => {
    const total = 2000;
    const d = deferredByOffset(total);

    const { result } = renderHook(() => usePaginatedLibrary("1"));
    await waitFor(() => expect(d.calls).toContain(0));
    act(() => d.resolve(0, 50));
    await waitFor(() => expect(result.current.totalSize).toBe(total));

    // Request a range around offset 1000 (chunk 1000 starts an in-flight fetch).
    let capturedSignal: AbortSignal | undefined;
    mockGetLibraryItems.mockImplementation(
      (_u: string, _t: string, _s: string, opts: { start: number; signal?: AbortSignal }) => {
        if (opts.start === 1000) capturedSignal = opts.signal;
        return new Promise(() => {});
      },
    );

    act(() => {
      result.current.ensureRange(1000, 1010);
    });
    await waitFor(() => expect(capturedSignal).toBeInstanceOf(AbortSignal));
    expect(capturedSignal?.aborted).toBe(false);

    // User immediately flings far away — chunk 1000 is no longer within the
    // (overscan-expanded) needed window, so it should be aborted rather than
    // left to complete uselessly.
    act(() => {
      result.current.ensureRange(1950, 1960);
    });

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("does not fetch when totalSize is not known yet (ensureRange before the first chunk resolves)", () => {
    mockGetLibraryItems.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePaginatedLibrary("1"));

    mockGetLibraryItems.mockClear();
    act(() => {
      result.current.ensureRange(500, 520);
    });
    expect(mockGetLibraryItems).not.toHaveBeenCalled();
  });

  it("stores fetched items in the sparse-store cache shape", async () => {
    const { result } = renderHook(() => usePaginatedLibrary("1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockCacheSet).toHaveBeenCalledWith(
      expect.stringContaining("library:https://plex.test:1:"),
      expect.objectContaining({ store: expect.any(Array), totalSize: 200 }),
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

  // ── loadAll mode (filtered alpha-sortable views) — unchanged fetch semantics ──

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
    expect(result.current.items.every((item) => item !== undefined)).toBe(true);
    expect(mockGetLibraryItems).toHaveBeenCalledTimes(2);
  });

  // ── prexu-0szx.18: bounded concurrency + keep-prior-items ──

  it("limits concurrent background batches to a bounded pool during loadAll", async () => {
    const total = 850; // first page (50) + exactly 4 batches of 200
    const firstPage = makeItems(50, 0);
    mockGetLibraryItems.mockResolvedValueOnce({
      items: firstPage,
      totalSize: total,
      hasMore: true,
    });

    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<() => void> = [];
    mockGetLibraryItems.mockImplementation(
      (_uri: string, _token: string, _section: string, opts: { start: number }) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          resolvers.push(() => {
            inFlight--;
            resolve({ items: makeItems(200, opts.start), totalSize: total, hasMore: true });
          });
        });
      }
    );

    const { result } = renderHook(() =>
      usePaginatedLibrary("1", "titleSort:asc", {}, { loadAll: true })
    );

    await waitFor(() => {
      // firstPage + exactly 4 concurrent background batches (the bounded pool)
      expect(mockGetLibraryItems).toHaveBeenCalledTimes(5);
    });
    expect(maxInFlight).toBe(4);

    resolvers.forEach((r) => r());

    await waitFor(() => {
      expect(result.current.isLoadingMore).toBe(false);
    });
    expect(result.current.items).toHaveLength(50 + 4 * 200);
    // No batches beyond the bounded pool were needed to cover the total.
    expect(mockGetLibraryItems).toHaveBeenCalledTimes(5);
  });

  // ── isFillComplete (prexu-hb1p: client-side cross-filtered facets) ──

  it("isFillComplete is false before totalSize is known (cold start)", () => {
    mockGetLibraryItems.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePaginatedLibrary("1", "titleSort:asc", {}, { loadAll: true }));

    expect(result.current.isFillComplete).toBe(false);
  });

  it("isFillComplete is false while a loadAll background fill is still in progress", async () => {
    mockGetLibraryItems
      .mockResolvedValueOnce({ items: makeItems(50, 0), totalSize: 100, hasMore: true })
      .mockReturnValue(new Promise(() => {})); // background batch never resolves in this window

    const { result } = renderHook(() =>
      usePaginatedLibrary("1", "titleSort:asc", {}, { loadAll: true })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    // First page is in, but only 50 of 100 total slots are populated.
    expect(result.current.isFillComplete).toBe(false);
  });

  it("isFillComplete flips true once every slot in the store is populated", async () => {
    const firstPage = makeItems(50, 0);
    const secondBatch = makeItems(50, 50);
    mockGetLibraryItems
      .mockResolvedValueOnce({ items: firstPage, totalSize: 100, hasMore: true })
      .mockResolvedValueOnce({ items: secondBatch, totalSize: 100, hasMore: false });

    const { result } = renderHook(() =>
      usePaginatedLibrary("1", "titleSort:asc", {}, { loadAll: true })
    );

    // Wait for the first page (isLoading's initial value is `true`, so this
    // is a genuine state transition to wait on) before checking
    // isLoadingMore — whose initial value is already `false`, so waiting on
    // it alone could spuriously resolve before the background fetch ever ran.
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    await waitFor(() => {
      expect(result.current.isLoadingMore).toBe(false);
    });
    expect(result.current.items).toHaveLength(100);
    expect(result.current.isFillComplete).toBe(true);
  });

  it("keeps previously loaded items visible (isStale) instead of blanking on a filter/sort change", async () => {
    mockGetLibraryItems.mockResolvedValueOnce({
      items: makeItems(10),
      totalSize: 10,
      hasMore: false,
    });

    const { result, rerender } = renderHook(
      ({ sort }: { sort: string }) => usePaginatedLibrary("1", sort),
      { initialProps: { sort: "titleSort:asc" } }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.items).toHaveLength(10);
    expect(result.current.isStale).toBe(false);

    // Sort changes → new cache key, cache miss, fetch never resolves in this window
    mockGetLibraryItems.mockReturnValue(new Promise(() => {}));
    rerender({ sort: "addedAt:desc" });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isStale).toBe(true);
    // The previous sort's items are still rendered, not blanked to [].
    expect(result.current.items).toHaveLength(10);
  });

  it("isStale is false during a true cold load (nothing previous to show)", () => {
    mockGetLibraryItems.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePaginatedLibrary("1"));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toHaveLength(0);
    expect(result.current.isStale).toBe(false);
  });

  it("rapid sort switching settles on the LAST selection, not whichever fetch resolves first", async () => {
    const pending = new Map<string, (v: unknown) => void>();
    mockGetLibraryItems.mockImplementation(
      (_u: string, _t: string, _s: string, opts: { sort?: string }) =>
        new Promise((resolve) => {
          pending.set(opts.sort ?? "", resolve);
        }),
    );

    const { result, rerender } = renderHook(
      ({ sort }: { sort: string }) => usePaginatedLibrary("1", sort),
      { initialProps: { sort: "titleSort:asc" } },
    );

    await waitFor(() => expect(pending.has("titleSort:asc")).toBe(true));

    rerender({ sort: "addedAt:desc" });
    await waitFor(() => expect(pending.has("addedAt:desc")).toBe(true));

    // Resolve the FIRST (now-stale) request after the second is already in
    // flight — its response must be dropped, not rendered.
    act(() => {
      pending.get("titleSort:asc")?.({
        items: makeItems(5, 0).map((i) => ({ ...i, title: `stale-${i.title}` })),
        totalSize: 5,
        hasMore: false,
      });
    });

    // Give the microtask queue a chance to run; state must NOT have adopted
    // the stale response.
    await Promise.resolve();
    expect(result.current.items.some((i) => i?.title.startsWith("stale-"))).toBe(false);

    // Now resolve the current (last-selected) request — this one should win.
    act(() => {
      pending.get("addedAt:desc")?.({
        items: makeItems(3, 0),
        totalSize: 3,
        hasMore: false,
      });
    });

    await waitFor(() => expect(result.current.totalSize).toBe(3));
    expect(result.current.items).toHaveLength(3);
  });

  // ── prexu-0szx.5: abort on unmount ──

  it("aborts the in-flight fetch on unmount", () => {
    let capturedSignal: AbortSignal | undefined;
    mockGetLibraryItems.mockImplementation(
      (_uri: string, _token: string, _section: string, opts: { signal?: AbortSignal }) => {
        capturedSignal = opts.signal;
        return new Promise(() => {});
      }
    );

    const { unmount } = renderHook(() => usePaginatedLibrary("1"));

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });
});
