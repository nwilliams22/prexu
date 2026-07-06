import { renderHook, act, waitFor } from "@testing-library/react";
import { useItemDetailData, warmItemDetailCache } from "./useItemDetailData";
import { cacheClear, cacheGet } from "../services/api-cache";
import {
  initializeCacheInvalidators,
  registerOffsetFloor,
  __clearOffsetFloorsForTests,
  OFFSET_FLOOR_WINDOW_MS,
} from "../services/cache-invalidators";
import { emitWatchStateChanged } from "../services/watch-state-events";

const stableServer = { uri: "https://plex.test", accessToken: "token" };

let currentRatingKey = "1";
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ ratingKey: currentRatingKey }),
    useNavigate: () => mockNavigate,
  };
});

vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: stableServer }),
}));

const mockUsePreferences = vi.fn(() => ({
  preferences: { appearance: { skipSingleSeason: false } },
  updatePreferences: vi.fn(),
  resetPreferences: vi.fn(),
}));
vi.mock("./usePreferences", () => ({
  usePreferences: () => mockUsePreferences(),
}));

const mockUseLibrary = vi.fn(() => ({
  sections: [] as { key: string; type: string }[],
}));
vi.mock("./useLibrary", () => ({
  useLibrary: () => mockUseLibrary(),
}));

const mockGetItemMetadata = vi.fn();
const mockGetItemChildren = vi.fn();
const mockGetRelatedItems = vi.fn();
const mockGetExtras = vi.fn();
const mockGetMediaByActor = vi.fn();
const mockGetCollections = vi.fn();
const mockGetCollectionItems = vi.fn();
vi.mock("../services/plex-library", () => ({
  getItemMetadata: (...args: unknown[]) => mockGetItemMetadata(...args),
  getItemChildren: (...args: unknown[]) => mockGetItemChildren(...args),
  getRelatedItems: (...args: unknown[]) => mockGetRelatedItems(...args),
  getExtras: (...args: unknown[]) => mockGetExtras(...args),
  getMediaByActor: (...args: unknown[]) => mockGetMediaByActor(...args),
  getCollections: (...args: unknown[]) => mockGetCollections(...args),
  getCollectionItems: (...args: unknown[]) => mockGetCollectionItems(...args),
}));

function makeMovie(ratingKey: string, title: string) {
  return { ratingKey, type: "movie", title };
}

function makeShow(ratingKey: string, title: string) {
  return { ratingKey, type: "show", title };
}

describe("useItemDetailData", () => {
  beforeEach(() => {
    currentRatingKey = "1";
    vi.clearAllMocks();
    cacheClear();
    mockUsePreferences.mockReturnValue({
      preferences: { appearance: { skipSingleSeason: false } },
      updatePreferences: vi.fn(),
      resetPreferences: vi.fn(),
    });
    mockGetRelatedItems.mockResolvedValue([]);
    mockGetExtras.mockResolvedValue([]);
    mockGetMediaByActor.mockResolvedValue([]);
    mockGetCollections.mockResolvedValue([]);
    mockGetCollectionItems.mockResolvedValue({ items: [] });
    mockUseLibrary.mockReturnValue({ sections: [] });
  });

  it("cold load: fetches metadata and populates item", async () => {
    mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Movie 1"));

    const { result } = renderHook(() => useItemDetailData());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.item?.title).toBe("Movie 1");
    expect(result.current.error).toBeNull();
  });

  it("cold load failure surfaces a page-level error", async () => {
    mockGetItemMetadata.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useItemDetailData());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("boom");
    expect(result.current.item).toBeNull();
  });

  it("serves a fresh cached bundle instantly with no network call (stale-while-revalidate)", async () => {
    mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Cached Movie"));
    await warmItemDetailCache(stableServer, "1");
    mockGetItemMetadata.mockClear();

    const { result } = renderHook(() => useItemDetailData());

    // Rendered synchronously from cache — no spinner, no blank state.
    expect(result.current.item?.title).toBe("Cached Movie");
    expect(result.current.isLoading).toBe(false);
    expect(mockGetItemMetadata).not.toHaveBeenCalled();

    // Flush the secondary related/extras/actors effect so it doesn't warn
    // about an unwrapped act() on an unrelated later test.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("serves a stale cached bundle instantly, then revalidates in the background", async () => {
    mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Old Title"));
    await warmItemDetailCache(stableServer, "1");
    mockGetItemMetadata.mockClear();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000); // past the 30s TTL
    mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "New Title"));

    const { result } = renderHook(() => useItemDetailData());

    // Instantly rendered from the stale entry — no blank/spinner.
    expect(result.current.item?.title).toBe("Old Title");
    expect(result.current.isLoading).toBe(false);

    vi.useRealTimers();

    await waitFor(() => {
      expect(result.current.item?.title).toBe("New Title");
    });
  });

  it("background revalidation failure keeps showing stale data without an error", async () => {
    mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Old Title"));
    await warmItemDetailCache(stableServer, "1");
    mockGetItemMetadata.mockClear();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000);

    let rejectFetch!: (e: Error) => void;
    mockGetItemMetadata.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectFetch = reject; })
    );

    const { result } = renderHook(() => useItemDetailData());

    expect(result.current.item?.title).toBe("Old Title");
    expect(result.current.isLoading).toBe(false);

    vi.useRealTimers();

    await act(async () => {
      rejectFetch(new Error("network down"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.item?.title).toBe("Old Title");
    expect(result.current.error).toBeNull();
  });

  it("refreshItem() forces a revalidation even when the cache is still fresh, without blanking the item", async () => {
    mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Original"));
    await warmItemDetailCache(stableServer, "1");
    mockGetItemMetadata.mockClear();

    const { result } = renderHook(() => useItemDetailData());
    expect(result.current.item?.title).toBe("Original");
    expect(mockGetItemMetadata).not.toHaveBeenCalled();

    let resolveFetch!: (v: unknown) => void;
    mockGetItemMetadata.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve; })
    );

    act(() => {
      result.current.refreshItem();
    });

    // Still showing the old item while the forced revalidation is in flight.
    expect(result.current.item?.title).toBe("Original");

    await act(async () => {
      resolveFetch(makeMovie("1", "Refreshed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.item?.title).toBe("Refreshed");
    });
  });

  it("cached render followed by an identical background revalidation does not clear or re-fetch already-loaded shelves", async () => {
    const cachedMovie = makeMovie("1", "Old Title");
    mockGetItemMetadata.mockResolvedValueOnce(cachedMovie);
    await warmItemDetailCache(stableServer, "1");
    mockGetItemMetadata.mockClear();

    mockGetRelatedItems.mockResolvedValueOnce([makeMovie("99", "Related Movie")]);
    mockGetExtras.mockResolvedValueOnce([makeMovie("98", "Trailer")]);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000); // past the 30s TTL
    // Revalidation returns data equivalent to what's cached (new object
    // identity, identical content) — the common case on every page open.
    mockGetItemMetadata.mockResolvedValueOnce({ ...cachedMovie });

    const { result } = renderHook(() => useItemDetailData());

    // Rendered instantly from cache.
    expect(result.current.item?.title).toBe("Old Title");
    expect(result.current.isLoading).toBe(false);

    vi.useRealTimers();

    await waitFor(() => {
      expect(result.current.related.length).toBe(1);
    });
    expect(result.current.extras.length).toBe(1);

    // Let the background revalidation (and anything it might re-trigger) settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Shelves survive the no-op revalidation instead of blanking and
    // re-fetching — the visible "refresh flash" this issue fixes.
    expect(result.current.related.length).toBe(1);
    expect(result.current.extras.length).toBe(1);
    expect(mockGetRelatedItems).toHaveBeenCalledTimes(1);
    expect(mockGetExtras).toHaveBeenCalledTimes(1);
  });

  // prexu-ct5k: a warm-cache entry paints core content (hero/cast) instantly
  // from the synchronous cache-hit path, but the related/extras/actors shelf
  // fetch is a real (micro-tasked) network call that lands well after that
  // first paint. Without a reserved-space flag, ItemDetail renders nothing
  // for those shelves until the fetch resolves, so their arrival pushes the
  // already-painted page around — the "entry flash" this issue fixes.
  describe("shelf/collection reserved-space flags (prexu-ct5k)", () => {
    it("shelvesLoading is already true in the same commit as a cache-hit core paint, then clears once shelves arrive", async () => {
      mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Cached Movie"));
      await warmItemDetailCache(stableServer, "1");
      mockGetItemMetadata.mockClear();

      mockGetRelatedItems.mockResolvedValueOnce([makeMovie("99", "Related Movie")]);
      mockGetExtras.mockResolvedValueOnce([makeMovie("98", "Trailer")]);

      const { result } = renderHook(() => useItemDetailData());

      // Core content and shelvesLoading=true land together, synchronously,
      // from the cache-hit path — the shelf fetch (a real Promise) hasn't
      // had a chance to resolve yet at this point.
      expect(result.current.item?.title).toBe("Cached Movie");
      expect(result.current.isLoading).toBe(false);
      expect(result.current.shelvesLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.shelvesLoading).toBe(false);
      });

      // Shelf data replaced the reservation; core stayed exactly as it was.
      expect(result.current.related.length).toBe(1);
      expect(result.current.extras.length).toBe(1);
      expect(result.current.item?.title).toBe("Cached Movie");
      expect(result.current.isLoading).toBe(false);
    });

    it("collectionLoading reserves space across the async collection lookup, then clears when it resolves", async () => {
      const cachedMovie = {
        ...makeMovie("1", "Cached Movie"),
        Collection: [{ tag: "Marvel" }],
      };
      mockGetItemMetadata.mockResolvedValueOnce(cachedMovie);
      await warmItemDetailCache(stableServer, "1");
      mockGetItemMetadata.mockClear();

      // A real movie section so the collection lookup effect actually
      // awaits a (mocked) network call instead of resolving synchronously.
      mockUseLibrary.mockReturnValue({ sections: [{ key: "1", type: "movie" }] });
      mockGetCollections.mockResolvedValueOnce([{ ratingKey: "c1", title: "Marvel" }]);
      mockGetCollectionItems.mockResolvedValueOnce({
        items: [makeMovie("55", "Other Marvel Movie")],
      });

      const { result } = renderHook(() => useItemDetailData());

      expect(result.current.item?.title).toBe("Cached Movie");
      expect(result.current.collectionLoading).toBe(true);
      expect(result.current.collectionItems).toBeNull();

      await waitFor(() => {
        expect(result.current.collectionLoading).toBe(false);
      });
      expect(result.current.collectionItems?.items.length).toBe(1);
    });

    it("collectionLoading resolves to false without ever showing a reservation for a movie with no collection", async () => {
      mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Plain Movie"));
      await warmItemDetailCache(stableServer, "1");
      mockGetItemMetadata.mockClear();

      const { result } = renderHook(() => useItemDetailData());

      await waitFor(() => {
        expect(result.current.collectionLoading).toBe(false);
      });
      expect(result.current.collectionItems).toBeNull();
      expect(mockGetCollections).not.toHaveBeenCalled();
    });

    it("navigating to a different item re-arms both reserved-space flags", async () => {
      mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Movie 1"));
      mockGetRelatedItems.mockResolvedValueOnce([makeMovie("99", "Related Movie")]);

      const { result, rerender } = renderHook(() => useItemDetailData());

      await waitFor(() => expect(result.current.shelvesLoading).toBe(false));
      expect(result.current.related.length).toBe(1);

      currentRatingKey = "2";
      mockGetItemMetadata.mockResolvedValueOnce(makeMovie("2", "Movie 2"));
      mockGetRelatedItems.mockResolvedValueOnce([]);

      rerender();

      // Navigating to a different item re-arms the reservation immediately,
      // in the same tick shelves are cleared — not one render later.
      expect(result.current.shelvesLoading).toBe(true);
      expect(result.current.related).toEqual([]);

      await waitFor(() => expect(result.current.item?.title).toBe("Movie 2"));
      await waitFor(() => expect(result.current.shelvesLoading).toBe(false));
    });
  });

  it("revalidation with only item-level watch-state changed applies silently: no scroll reset, no loading flip, unrelated bundle fields keep their prior reference (prexu-adiv)", async () => {
    const main = document.createElement("main");
    document.body.appendChild(main);
    main.scrollTop = 500;
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    // Simulates the reported repro: the item was cached before playback,
    // then the user watched (or is watching) it elsewhere, so only
    // viewOffset differs on the revalidated bundle — everything else
    // (seasons/episodes/siblings, all empty arrays for a movie) is
    // content-identical.
    const cachedMovie = { ...makeMovie("1", "Movie 1"), viewOffset: 1000 };
    mockGetItemMetadata.mockResolvedValueOnce(cachedMovie);
    await warmItemDetailCache(stableServer, "1");
    mockGetItemMetadata.mockClear();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000); // past the 30s TTL
    mockGetItemMetadata.mockResolvedValueOnce({ ...cachedMovie, viewOffset: 45_000 });

    const { result } = renderHook(() => useItemDetailData());

    const seasonsBefore = result.current.seasons;
    const episodesBefore = result.current.episodes;
    const siblingEpisodesBefore = result.current.siblingEpisodes;
    const siblingSeasonsBefore = result.current.siblingSeasons;
    expect(result.current.item?.viewOffset).toBe(1000);
    expect(result.current.isLoading).toBe(false);

    vi.useRealTimers();

    await waitFor(() => {
      expect(result.current.item?.viewOffset).toBe(45_000);
    });

    // The only thing that visibly changed is the item's own viewOffset —
    // seasons/episodes/siblings were never re-set, so they keep the exact
    // same array reference (not just deep-equal) as before the
    // revalidation. isLoading never flipped back to true (no skeleton
    // flash) and nothing touched scroll position (no full-page reset).
    expect(result.current.seasons).toBe(seasonsBefore);
    expect(result.current.episodes).toBe(episodesBefore);
    expect(result.current.siblingEpisodes).toBe(siblingEpisodesBefore);
    expect(result.current.siblingSeasons).toBe(siblingSeasonsBefore);
    expect(result.current.isLoading).toBe(false);
    expect(main.scrollTop).toBe(500);
    expect(scrollToSpy).not.toHaveBeenCalled();

    scrollToSpy.mockRestore();
    document.body.removeChild(main);
  });

  it("logs which top-level bundle keys and item fields differ when a revalidation changes data (prexu-adiv)", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const cachedMovie = { ...makeMovie("1", "Movie 1"), viewOffset: 1000 };
    mockGetItemMetadata.mockResolvedValueOnce(cachedMovie);
    await warmItemDetailCache(stableServer, "1");
    mockGetItemMetadata.mockClear();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000);
    mockGetItemMetadata.mockResolvedValueOnce({ ...cachedMovie, viewOffset: 45_000 });

    const { result } = renderHook(() => useItemDetailData());
    vi.useRealTimers();

    await waitFor(() => {
      expect(result.current.item?.viewOffset).toBe(45_000);
    });

    const call = debugSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("applying only the changed bundle fields"),
    );
    expect(call).toBeTruthy();
    const logged = call?.[0] as string;
    expect(logged).toContain('"changedKeys":["item"]');
    expect(logged).toContain('"itemFieldDiffs":["viewOffset"]');

    debugSpy.mockRestore();
  });

  it("refreshItem() (forced same-item revalidation) does not clear already-loaded shelves", async () => {
    mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Original"));
    await warmItemDetailCache(stableServer, "1");
    mockGetItemMetadata.mockClear();

    mockGetRelatedItems.mockResolvedValueOnce([makeMovie("99", "Related Movie")]);
    mockGetExtras.mockResolvedValueOnce([makeMovie("98", "Trailer")]);

    const { result } = renderHook(() => useItemDetailData());
    expect(result.current.item?.title).toBe("Original");

    await waitFor(() => expect(result.current.related.length).toBe(1));
    expect(result.current.extras.length).toBe(1);

    let resolveFetch!: (v: unknown) => void;
    mockGetItemMetadata.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve; })
    );

    act(() => {
      result.current.refreshItem();
    });

    // The forced revalidation is in flight but the shelves must stay put —
    // this used to blank to [] synchronously here (top-of-effect clear).
    expect(result.current.related.length).toBe(1);
    expect(result.current.extras.length).toBe(1);

    await act(async () => {
      resolveFetch(makeMovie("1", "Original"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.related.length).toBe(1);
    expect(result.current.extras.length).toBe(1);
  });

  it("navigating to a different ratingKey clears prior shelves", async () => {
    mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Movie 1"));
    mockGetRelatedItems.mockResolvedValueOnce([makeMovie("99", "Related Movie")]);

    const { result, rerender } = renderHook(() => useItemDetailData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.related.length).toBe(1));

    // Navigate to a different item.
    currentRatingKey = "2";
    mockGetItemMetadata.mockResolvedValueOnce(makeMovie("2", "Movie 2"));
    mockGetRelatedItems.mockResolvedValueOnce([]);

    rerender();

    // Shelves clear immediately on navigating to a different item, instead
    // of showing the previous item's related shelf while the new item loads.
    expect(result.current.related).toEqual([]);

    await waitFor(() => expect(result.current.item?.title).toBe("Movie 2"));
  });

  it("aborts the in-flight fetch on unmount", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockGetItemMetadata.mockImplementation((..._args: unknown[]) => {
      capturedSignal = _args[3] as AbortSignal;
      return new Promise(() => {});
    });

    const { unmount } = renderHook(() => useItemDetailData());

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("redirects to the sole season when skipSingleSeason preference is enabled", async () => {
    mockUsePreferences.mockReturnValue({
      preferences: { appearance: { skipSingleSeason: true } },
      updatePreferences: vi.fn(),
      resetPreferences: vi.fn(),
    });
    mockGetItemMetadata.mockResolvedValueOnce(makeShow("1", "Show A"));
    mockGetItemChildren.mockResolvedValueOnce([
      { ratingKey: "s1", type: "season", title: "Season 1" },
    ]);

    renderHook(() => useItemDetailData());

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/item/s1", { replace: true });
    });
  });

  it("does not redirect a cached single-season show once already viewing it", async () => {
    // Regression guard: applyBundle must run the same redirect check whether
    // data comes from cache or a fresh fetch.
    mockUsePreferences.mockReturnValue({
      preferences: { appearance: { skipSingleSeason: false } },
      updatePreferences: vi.fn(),
      resetPreferences: vi.fn(),
    });
    mockGetItemMetadata.mockResolvedValueOnce(makeShow("1", "Show A"));
    mockGetItemChildren.mockResolvedValueOnce([
      { ratingKey: "s1", type: "season", title: "Season 1" },
    ]);

    const { result } = renderHook(() => useItemDetailData());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(result.current.item?.title).toBe("Show A");
  });

  // prexu-lz4t: hovering the same item right after a stop-write used to log
  // "already warm, skipping" forever (up to the 30s TTL) because nothing
  // invalidated the item-detail cache on watch-state change — only the
  // dashboard's onDeck ("deck") cache was. initializeCacheInvalidators wires
  // the persistent, never-unsubscribed listener that now also invalidates
  // item-detail entries; it's set up once here (same reasoning as
  // cache-invalidators.test.ts's own describe block: calling it per-test
  // would stack duplicate listeners on `window`).
  describe("watch-state invalidation of the item-detail cache (prexu-lz4t)", () => {
    beforeAll(() => {
      initializeCacheInvalidators();
    });

    it("hover after a watch-state change refetches instead of serving the stale warm cache", async () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

      mockGetItemMetadata.mockResolvedValueOnce({
        ...makeMovie("1", "Movie 1"),
        viewOffset: 1000,
      });
      await warmItemDetailCache(stableServer, "1");

      // Baseline: re-warming immediately (no watch-state change in between)
      // is a no-op — this is the "already warm, skipping" bug's precondition.
      debugSpy.mockClear();
      await warmItemDetailCache(stableServer, "1");
      expect(
        debugSpy.mock.calls.some(
          ([msg]) => typeof msg === "string" && msg.includes("already warm, skipping"),
        ),
      ).toBe(true);

      // Playback stops; the server records a new offset and the app emits
      // the watch-state-changed event carrying this item's ratingKey.
      debugSpy.mockClear();
      emitWatchStateChanged("1");

      mockGetItemMetadata.mockResolvedValueOnce({
        ...makeMovie("1", "Movie 1"),
        viewOffset: 45_000,
      });
      await warmItemDetailCache(stableServer, "1");

      expect(
        debugSpy.mock.calls.some(
          ([msg]) => typeof msg === "string" && msg.includes("warmItemDetailCache: prefetched"),
        ),
      ).toBe(true);
      expect(
        debugSpy.mock.calls.some(
          ([msg]) => typeof msg === "string" && msg.includes("already warm, skipping"),
        ),
      ).toBe(false);

      debugSpy.mockRestore();
    });

    it("leaves an unrelated item's warm cache entry untouched", async () => {
      mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Movie 1"));
      await warmItemDetailCache(stableServer, "1");
      mockGetItemMetadata.mockResolvedValueOnce(makeMovie("2", "Movie 2"));
      await warmItemDetailCache(stableServer, "2");
      mockGetItemMetadata.mockClear();

      // Only item "1"'s watch state changed.
      emitWatchStateChanged("1");

      // Item "2" should still be warm — no refetch triggered.
      await warmItemDetailCache(stableServer, "2");
      expect(mockGetItemMetadata).not.toHaveBeenCalled();
    });

    it("invalidates every item-detail entry when the event carries no ratingKey", async () => {
      mockGetItemMetadata.mockResolvedValueOnce(makeMovie("1", "Movie 1"));
      await warmItemDetailCache(stableServer, "1");
      mockGetItemMetadata.mockResolvedValueOnce(makeMovie("2", "Movie 2"));
      await warmItemDetailCache(stableServer, "2");
      mockGetItemMetadata.mockClear();
      mockGetItemMetadata.mockResolvedValue(makeMovie("1", "Movie 1 refetched"));

      // Documented fallback: no ratingKey on the event means we can't target
      // precisely, so every item-detail entry is treated as stale.
      emitWatchStateChanged();

      await warmItemDetailCache(stableServer, "1");
      await warmItemDetailCache(stableServer, "2");
      expect(mockGetItemMetadata).toHaveBeenCalledTimes(2);
    });

    // prexu-5mcz: hardware log chain proved the item-detail entry crossed its
    // 30s TTL just ONE SECOND after the watch-state patch ran, because the
    // patch (before this fix) preserved the entry's ORIGINAL timestamp — from
    // whenever it was first warmed, well before the stop — rather than
    // resetting it. That let a hover-triggered warmItemDetailCache treat the
    // entry as stale and issue a real fetch, which raced PMS's own async
    // ingestion of the stop write and re-cached the PRE-stop offset, silently
    // undoing the patch. The patch must refresh the TTL so the patched value
    // (known-fresher than anything the server can return in-window) doesn't
    // expire behind a stale response moments later.
    it("keeps the item-detail entry warm well past its original TTL once a watch-state patch refreshes it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

      mockGetItemMetadata.mockResolvedValueOnce({
        ...makeMovie("1", "Movie 1"),
        viewOffset: 1000,
      });
      await warmItemDetailCache(stableServer, "1"); // T0, 30s TTL starts

      // T0+25s — close to (but still within) the original 30s TTL, matching
      // the hardware repro's timing.
      vi.setSystemTime(Date.now() + 25_000);
      emitWatchStateChanged("1", { viewOffsetMs: 710561 }); // patch at T

      mockGetItemMetadata.mockClear();
      debugSpy.mockClear();

      // T+29s (= T0+54s) — 24s PAST the entry's ORIGINAL expiry (T0+30s),
      // but still within the patch's own fresh 30s window (T+30s = T0+55s).
      vi.setSystemTime(Date.now() + 29_000);

      await warmItemDetailCache(stableServer, "1");

      // Still warm — no refetch, because the patch reset the freshness clock.
      expect(mockGetItemMetadata).not.toHaveBeenCalled();
      expect(
        debugSpy.mock.calls.some(
          ([msg]) => typeof msg === "string" && msg.includes("already warm, skipping"),
        ),
      ).toBe(true);

      vi.useRealTimers();
      debugSpy.mockRestore();
    });
  });

  // prexu-5mcz: the final gap in this bug — the deck fetch path
  // (useDashboard's applyOffsetFloors call) was the only thing consulting the
  // offset-floor registry. A hover-intent prefetch of the item-detail bundle
  // had no floor guard at all, so it could land within the floor's window and
  // re-cache a PRE-stop viewOffset PMS hadn't finished ingesting yet — exactly
  // what the hardware log chain showed happening one second after a stop.
  // fetchDetailBundle (the choke point both the hook's own fetch effect and
  // warmItemDetailCache go through) now runs every fetched bundle through the
  // same applyOffsetFloors merge rule the deck path already trusted.
  describe("offset floor on the detail fetch path (prexu-5mcz)", () => {
    beforeEach(() => {
      __clearOffsetFloorsForTests();
    });

    afterEach(() => {
      __clearOffsetFloorsForTests();
    });

    it("floors a fetched viewOffset that is older (stale) than a registered floor before caching it", async () => {
      registerOffsetFloor("1", 710561, false);
      mockGetItemMetadata.mockResolvedValueOnce({
        ...makeMovie("1", "Movie 1"),
        viewOffset: 642142, // PMS's PRE-stop offset — ingestion lag
      });

      await warmItemDetailCache(stableServer, "1");

      expect(cacheGet<{ item: { viewOffset?: number } }>("item-detail:https://plex.test:1")?.item.viewOffset).toBe(
        710561,
      );
    });

    it("passes through a fetched viewOffset that is newer/larger than the floor unmodified", async () => {
      registerOffsetFloor("1", 100_000, false);
      mockGetItemMetadata.mockResolvedValueOnce({
        ...makeMovie("1", "Movie 1"),
        viewOffset: 200_000,
      });

      await warmItemDetailCache(stableServer, "1");

      expect(cacheGet<{ item: { viewOffset?: number } }>("item-detail:https://plex.test:1")?.item.viewOffset).toBe(
        200_000,
      );
    });

    it("forces a fetched viewOffset to 0 when a reset floor is registered, even if the server hasn't caught up", async () => {
      registerOffsetFloor("1", 0, true);
      mockGetItemMetadata.mockResolvedValueOnce({
        ...makeMovie("1", "Movie 1"),
        viewOffset: 500_000,
      });

      await warmItemDetailCache(stableServer, "1");

      expect(cacheGet<{ item: { viewOffset?: number } }>("item-detail:https://plex.test:1")?.item.viewOffset).toBe(0);
    });

    it("no longer floors a fetched viewOffset once the floor's window has expired", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      registerOffsetFloor("1", 710561, false);
      vi.setSystemTime(Date.now() + OFFSET_FLOOR_WINDOW_MS + 1);
      mockGetItemMetadata.mockResolvedValueOnce({
        ...makeMovie("1", "Movie 1"),
        viewOffset: 642142,
      });

      await warmItemDetailCache(stableServer, "1");
      vi.useRealTimers();

      expect(cacheGet<{ item: { viewOffset?: number } }>("item-detail:https://plex.test:1")?.item.viewOffset).toBe(
        642142,
      );
    });

    it("floors a matching episode child's viewOffset inside a season bundle, leaving other episodes untouched", async () => {
      currentRatingKey = "s1";
      registerOffsetFloor("e2", 300_000, false);

      mockGetItemMetadata.mockResolvedValueOnce({
        ratingKey: "s1",
        type: "season",
        title: "Season 1",
        parentRatingKey: "show1",
      });
      mockGetItemMetadata.mockResolvedValueOnce({
        ratingKey: "show1",
        type: "show",
        title: "Show A",
      });
      mockGetItemChildren.mockResolvedValueOnce([
        { ratingKey: "e1", type: "episode", title: "Episode 1", viewOffset: 1_000 },
        { ratingKey: "e2", type: "episode", title: "Episode 2", viewOffset: 50_000 },
      ]);
      mockGetItemChildren.mockResolvedValueOnce([
        { ratingKey: "s1", type: "season", title: "Season 1" },
      ]);

      const { result } = renderHook(() => useItemDetailData());

      await waitFor(() => expect(result.current.episodes.length).toBe(2));

      const e1 = result.current.episodes.find((e) => e.ratingKey === "e1");
      const e2 = result.current.episodes.find((e) => e.ratingKey === "e2");
      expect(e1?.viewOffset).toBe(1_000); // untouched — no floor for e1
      expect(e2?.viewOffset).toBe(300_000); // floored up from the stale 50_000
    });
  });

  // prexu-kwqe: the fifth and final layer of this bug. Every prior fix
  // (#66/#72/#79/#81, exercised above) repaired the CACHE — none of them
  // touch this hook's own mounted `item`/`episodes`/`siblingEpisodes` React
  // state, which is set once from cache on page entry and (before this fix)
  // never revisited. Because the player is an overlay, the detail page stays
  // mounted across a play/stop cycle, so the hero's "Resume from" label (which
  // reads this hook's `item` state directly — see ItemHeroSection) went stale
  // on every in-page replay no matter how correct the cache underneath it was.
  describe("watch-state event keeps mounted state in sync (prexu-kwqe)", () => {
    // Isolate from the module-level offset-floor registry (prexu-8nl0/5mcz):
    // emitting an event with a payload through this file's persistent
    // cache-invalidators listener (registered once in the describe above)
    // also registers a floor for that ratingKey, which would otherwise leak
    // into a later test's cold-load fetch in this describe and float its
    // viewOffset up via applyOffsetFloors.
    beforeEach(() => {
      __clearOffsetFloorsForTests();
    });
    afterEach(() => {
      __clearOffsetFloorsForTests();
    });

    it("updates the mounted item's viewOffset in place for a matching ratingKey event, without touching shelves/scroll/loading", async () => {
      const main = document.createElement("main");
      document.body.appendChild(main);
      const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

      // Warm the cache first (like the PR #63/#73 scroll-invariant test
      // above) so the hook takes the CACHE-HIT path on mount, not a true
      // cold load — a cold load unconditionally resets scroll to 0, which
      // would be indistinguishable from a regression this test is meant to
      // catch.
      const cachedMovie = { ...makeMovie("1", "Movie 1"), viewOffset: 1_000 };
      mockGetItemMetadata.mockResolvedValueOnce(cachedMovie);
      await warmItemDetailCache(stableServer, "1");
      mockGetItemMetadata.mockClear();

      mockGetRelatedItems.mockResolvedValueOnce([makeMovie("99", "Related Movie")]);
      mockGetExtras.mockResolvedValueOnce([makeMovie("98", "Trailer")]);

      const { result } = renderHook(() => useItemDetailData());

      // Rendered synchronously from cache — no cold-load scroll reset.
      expect(result.current.item?.viewOffset).toBe(1_000);
      expect(result.current.isLoading).toBe(false);

      main.scrollTop = 300; // simulate the user having scrolled down the page

      await waitFor(() => expect(result.current.shelvesLoading).toBe(false));
      expect(result.current.collectionLoading).toBe(false);

      const seasonsBefore = result.current.seasons;
      const episodesBefore = result.current.episodes;
      const siblingEpisodesBefore = result.current.siblingEpisodes;
      const siblingSeasonsBefore = result.current.siblingSeasons;
      const relatedBefore = result.current.related;
      const extrasBefore = result.current.extras;

      debugSpy.mockClear();
      act(() => {
        emitWatchStateChanged("1", { viewOffsetMs: 45_000 });
      });

      expect(result.current.item?.viewOffset).toBe(45_000);
      // Invariant (PR #63/#73): a same-item state update must not clear
      // shelves, re-fire the shelf/collection effects (keyed on
      // item?.ratingKey — unchanged here), flip a loading flag, or reset
      // scroll.
      expect(result.current.isLoading).toBe(false);
      expect(result.current.shelvesLoading).toBe(false);
      expect(result.current.collectionLoading).toBe(false);
      expect(result.current.seasons).toBe(seasonsBefore);
      expect(result.current.episodes).toBe(episodesBefore);
      expect(result.current.siblingEpisodes).toBe(siblingEpisodesBefore);
      expect(result.current.siblingSeasons).toBe(siblingSeasonsBefore);
      expect(result.current.related).toBe(relatedBefore);
      expect(result.current.extras).toBe(extrasBefore);
      expect(main.scrollTop).toBe(300);
      expect(scrollToSpy).not.toHaveBeenCalled();

      expect(
        debugSpy.mock.calls.some(
          ([msg]) =>
            typeof msg === "string" &&
            msg.includes("mounted item state updated from watch-state event"),
        ),
      ).toBe(true);

      scrollToSpy.mockRestore();
      debugSpy.mockRestore();
      document.body.removeChild(main);
    });

    it("ignores an event for a non-matching ratingKey", async () => {
      mockGetItemMetadata.mockResolvedValueOnce({
        ...makeMovie("1", "Movie 1"),
        viewOffset: 1_000,
      });
      mockGetRelatedItems.mockResolvedValueOnce([]);
      mockGetExtras.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useItemDetailData());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      const itemBefore = result.current.item;

      act(() => {
        emitWatchStateChanged("999", { viewOffsetMs: 45_000 });
      });

      // Untouched — same object reference, not just the same value.
      expect(result.current.item).toBe(itemBefore);
      expect(result.current.item?.viewOffset).toBe(1_000);
    });

    it("a reset event forces the mounted item's viewOffset to 0", async () => {
      mockGetItemMetadata.mockResolvedValueOnce({
        ...makeMovie("1", "Movie 1"),
        viewOffset: 45_000,
      });
      mockGetRelatedItems.mockResolvedValueOnce([]);
      mockGetExtras.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useItemDetailData());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.item?.viewOffset).toBe(45_000);

      act(() => {
        emitWatchStateChanged("1", { viewOffsetMs: 0, reset: true });
      });

      expect(result.current.item?.viewOffset).toBe(0);
    });

    it("updates a matching episode child's viewOffset on a season page, leaving unrelated episodes and the season item itself untouched", async () => {
      currentRatingKey = "s1";

      mockGetItemMetadata.mockResolvedValueOnce({
        ratingKey: "s1",
        type: "season",
        title: "Season 1",
        parentRatingKey: "show1",
      });
      mockGetItemMetadata.mockResolvedValueOnce({
        ratingKey: "show1",
        type: "show",
        title: "Show A",
      });
      mockGetItemChildren.mockResolvedValueOnce([
        { ratingKey: "e1", type: "episode", title: "Episode 1", viewOffset: 1_000 },
        { ratingKey: "e2", type: "episode", title: "Episode 2", viewOffset: 50_000 },
      ]);
      mockGetItemChildren.mockResolvedValueOnce([
        { ratingKey: "s1", type: "season", title: "Season 1" },
      ]);

      const { result } = renderHook(() => useItemDetailData());
      await waitFor(() => expect(result.current.episodes.length).toBe(2));

      const seasonItemBefore = result.current.item;
      const e1Before = result.current.episodes.find((e) => e.ratingKey === "e1");

      act(() => {
        emitWatchStateChanged("e2", { viewOffsetMs: 710_561 });
      });

      const e1After = result.current.episodes.find((e) => e.ratingKey === "e1");
      const e2After = result.current.episodes.find((e) => e.ratingKey === "e2");
      expect(e2After?.viewOffset).toBe(710_561);
      expect(e1After).toBe(e1Before); // unrelated sibling untouched — same reference
      // The season's own ratingKey ("s1") never matches an episode event —
      // the mounted season item itself is left alone.
      expect(result.current.item).toBe(seasonItemBefore);
    });

    it("updates a matching sibling episode's viewOffset on an episode detail page", async () => {
      mockGetItemMetadata.mockResolvedValueOnce({
        ratingKey: "1",
        type: "episode",
        title: "Episode 1",
        parentRatingKey: "season1",
      });
      mockGetItemChildren.mockResolvedValueOnce([
        { ratingKey: "1", type: "episode", title: "Episode 1", viewOffset: 1_000 },
        { ratingKey: "e2", type: "episode", title: "Episode 2", viewOffset: 50_000 },
      ]);

      const { result } = renderHook(() => useItemDetailData());
      await waitFor(() => expect(result.current.siblingEpisodes.length).toBe(2));

      act(() => {
        emitWatchStateChanged("e2", { viewOffsetMs: 999_000 });
      });

      const e2After = result.current.siblingEpisodes.find((e) => e.ratingKey === "e2");
      expect(e2After?.viewOffset).toBe(999_000);
    });

    it("unsubscribes the watch-state listener on unmount — no update fires afterward", async () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

      mockGetItemMetadata.mockResolvedValueOnce({
        ...makeMovie("1", "Movie 1"),
        viewOffset: 1_000,
      });
      mockGetRelatedItems.mockResolvedValueOnce([]);
      mockGetExtras.mockResolvedValueOnce([]);

      const { result, unmount } = renderHook(() => useItemDetailData());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      unmount();
      debugSpy.mockClear();

      emitWatchStateChanged("1", { viewOffsetMs: 45_000 });

      // If the listener were still attached, this update would still log —
      // its absence proves the effect's cleanup unsubscribed it.
      expect(
        debugSpy.mock.calls.some(
          ([msg]) =>
            typeof msg === "string" &&
            msg.includes("mounted item state updated from watch-state event"),
        ),
      ).toBe(false);

      debugSpy.mockRestore();
    });

    it("ignores payload-less legacy watch-state events gracefully", async () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

      mockGetItemMetadata.mockResolvedValueOnce({
        ...makeMovie("1", "Movie 1"),
        viewOffset: 1_000,
      });
      mockGetRelatedItems.mockResolvedValueOnce([]);
      mockGetExtras.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useItemDetailData());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      debugSpy.mockClear();

      act(() => {
        emitWatchStateChanged(); // bare legacy event — no ratingKey, no offset
      });
      expect(result.current.item?.viewOffset).toBe(1_000);

      act(() => {
        emitWatchStateChanged("1"); // PR #66-style event — ratingKey but no offset
      });
      expect(result.current.item?.viewOffset).toBe(1_000);

      expect(
        debugSpy.mock.calls.some(
          ([msg]) =>
            typeof msg === "string" &&
            msg.includes("mounted item state updated from watch-state event"),
        ),
      ).toBe(false);

      debugSpy.mockRestore();
    });
  });
});
