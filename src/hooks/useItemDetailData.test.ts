import { renderHook, act, waitFor } from "@testing-library/react";
import { useItemDetailData, warmItemDetailCache } from "./useItemDetailData";
import { cacheClear } from "../services/api-cache";

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
});
