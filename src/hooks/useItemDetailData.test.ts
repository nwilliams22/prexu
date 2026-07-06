import { renderHook, act, waitFor } from "@testing-library/react";
import { useItemDetailData, warmItemDetailCache } from "./useItemDetailData";
import { cacheClear } from "../services/api-cache";
import { initializeCacheInvalidators } from "../services/cache-invalidators";
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

const stableSections: never[] = [];
vi.mock("./useLibrary", () => ({
  useLibrary: () => ({ sections: stableSections }),
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
  });
});
