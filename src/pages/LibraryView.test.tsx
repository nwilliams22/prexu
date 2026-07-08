import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LibraryView from "./LibraryView";

const mockUseParams = vi.fn(() => ({ sectionId: "1" }));
const mockSetSearchParams = vi.fn();
const mockUseSearchParams = vi.fn(
  (): [URLSearchParams, typeof mockSetSearchParams] => [
    new URLSearchParams(),
    mockSetSearchParams,
  ]
);
// Defaults to "POP" (React Router's action for a MemoryRouter's initial
// entry) — tests that care about PUSH override this explicitly (prexu-5f12).
const mockUseNavigationType = vi.fn((): "POP" | "PUSH" | "REPLACE" => "POP");
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => mockUseParams(),
    useSearchParams: () => mockUseSearchParams(),
    useNavigate: () => vi.fn(),
    useNavigationType: () => mockUseNavigationType(),
  };
});

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://plex.test", accessToken: "token" },
  }),
}));

const mockUsePaginatedLibrary = vi.fn();
vi.mock("../hooks/usePaginatedLibrary", () => ({
  usePaginatedLibrary: (...args: unknown[]) =>
    mockUsePaginatedLibrary(...args),
}));

vi.mock("../hooks/useLibrary", () => ({
  useLibrary: () => ({
    sections: [
      { key: "1", title: "Movies", type: "movie" },
      { key: "2", title: "TV Shows", type: "show" },
    ],
  }),
}));

const mockUseFirstCharacter = vi.fn(() => ({
  letters: new Set<string>(),
  buckets: [] as { key: string; size: number }[],
  isLoading: false,
  error: null as string | null,
}));
vi.mock("../hooks/useFirstCharacter", async () => {
  const actual = await vi.importActual<typeof import("../hooks/useFirstCharacter")>(
    "../hooks/useFirstCharacter",
  );
  return {
    // `computeLetterOffsets` is a pure function LibraryView relies on
    // directly — keep the real implementation so offset math stays honest.
    computeLetterOffsets: actual.computeLetterOffsets,
    useFirstCharacter: (...args: unknown[]) => mockUseFirstCharacter(...(args as [])),
  };
});

const mockLoggerDebug = vi.fn();
vi.mock("../services/logger", () => ({
  logger: {
    debug: (...args: unknown[]) => mockLoggerDebug(...args),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

const mockUseFilterOptions = vi.fn(() => ({
  genres: [] as { key: string; title: string }[],
  years: [] as { key: string; title: string }[],
  contentRatings: [] as { key: string; title: string }[],
  resolutions: [] as { key: string; title: string }[],
  isLoading: false,
}));
vi.mock("../hooks/useFilterOptions", () => ({
  useFilterOptions: (...args: unknown[]) => mockUseFilterOptions(...(args as [])),
}));

vi.mock("../hooks/useMediaContextMenu", () => ({
  useMediaContextMenu: () => ({ openContextMenu: vi.fn(), overlays: null }),
}));

// Cache one play handler PER ratingKey, mirroring the real usePlayAction
// contract (a stable per-key handler, undefined for non-playable types) so the
// callback-identity-stability suite (prexu-9f4s.1) can assert onPlay identity.
const mockPlayHandlers = new Map<string, (e: React.MouseEvent) => void>();
vi.mock("../hooks/usePlayAction", () => ({
  usePlayAction: () => ({
    getPlayHandler: (item: { ratingKey: string; type: string }) => {
      if (item.type !== "movie" && item.type !== "episode") return undefined;
      if (!mockPlayHandlers.has(item.ratingKey)) {
        mockPlayHandlers.set(item.ratingKey, () => {});
      }
      return mockPlayHandlers.get(item.ratingKey);
    },
    playOverlay: null,
  }),
}));

vi.mock("../hooks/useCollections", () => ({
  useSectionCollections: () => ({
    collections: [],
    watchedMap: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => "desktop",
  isMobile: () => false,
}));

vi.mock("../hooks/usePreferences", () => ({
  usePreferences: () => ({
    preferences: {
      appearance: { minCollectionSize: 2 },
      playback: {},
    },
    updatePreferences: vi.fn(),
    resetPreferences: vi.fn(),
  }),
}));

const mockUseParentalControls = vi.fn();
vi.mock("../hooks/useParentalControls", () => ({
  useParentalControls: () => mockUseParentalControls(),
}));

// Stored externally (rather than a bare `vi.fn()` inside the factory) so
// tests can inspect the options LibraryView passes it and invoke the
// `onRestore` callback directly to assert the resulting timing log
// (prexu-5f12) — matching the outer-variable pattern already used for
// mockUsePaginatedLibrary/mockUseFilterOptions above.
const mockUseScrollRestoration = vi.fn();
vi.mock("../hooks/useScrollRestoration", () => ({
  useScrollRestoration: (...args: unknown[]) => mockUseScrollRestoration(...args),
}));

vi.mock("../services/plex-library", () => ({
  getImageUrl: vi.fn(() => "http://img.test/poster.jpg"),
  getPlaceholderUrl: vi.fn(() => "http://img.test/placeholder.jpg"),
  getImageSrcSet: vi.fn(() => ""),
}));

vi.mock("../utils/media-helpers", () => ({
  getMediaSubtitle: vi.fn(() => "2023"),
  isWatched: vi.fn(() => false),
  getUnwatchedCount: vi.fn(() => 0),
}));

vi.mock("../components/LibraryGrid", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="library-grid">{children}</div>
  ),
}));


// Renders the option keys it actually received so cross-filtered facet
// narrowing (prexu-hb1p) can be asserted end to end without pulling in the
// real FilterBar's DOM/styling.
vi.mock("../components/FilterBar", () => ({
  default: ({
    genres,
    years,
    contentRatings,
    resolutions,
  }: {
    genres: { key: string; title: string }[];
    years: { key: string; title: string }[];
    contentRatings: { key: string; title: string }[];
    resolutions: { key: string; title: string }[];
  }) => (
    <div data-testid="filter-bar">
      <div data-testid="filter-bar-genres">{genres.map((g) => g.key).join(",")}</div>
      <div data-testid="filter-bar-years">{years.map((y) => y.key).join(",")}</div>
      <div data-testid="filter-bar-content-ratings">
        {contentRatings.map((c) => c.key).join(",")}
      </div>
      <div data-testid="filter-bar-resolutions">{resolutions.map((r) => r.key).join(",")}</div>
    </div>
  ),
}));

// Records the callback props PosterCard receives, keyed by ratingKey, one
// snapshot per render — lets the identity-stability suite (prexu-9f4s.1)
// assert the same handler references survive across grid re-renders.
const mockCapturedPosterProps: Record<string, Array<Record<string, unknown>>> = {};
vi.mock("../components/PosterCard", () => ({
  default: (props: {
    ratingKey: string;
    title: string;
    onClick?: unknown;
    onPlay?: unknown;
    onContextMenu?: unknown;
    onMoreClick?: unknown;
  }) => {
    (mockCapturedPosterProps[props.ratingKey] ??= []).push({
      onClick: props.onClick,
      onPlay: props.onPlay,
      onContextMenu: props.onContextMenu,
      onMoreClick: props.onMoreClick,
    });
    return <div data-testid="poster-card">{props.title}</div>;
  },
}));

vi.mock("../components/SkeletonCard", () => ({
  default: () => <div data-testid="skeleton-card" />,
}));

vi.mock("../components/ShowExpansionPanel", () => ({
  default: () => <div data-testid="show-expansion-panel" />,
}));

// Renders real, clickable letter buttons (disabled when unavailable, mirroring
// the production component) so alpha-jump wiring can be exercised end to end.
vi.mock("../components/AlphaJumpBar", () => ({
  default: ({
    onJump,
    availableLetters,
  }: {
    onJump: (letter: string) => void;
    availableLetters?: Set<string>;
  }) => (
    <div data-testid="alpha-jump-bar">
      {"#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => (
        <button
          key={letter}
          onClick={() => onJump(letter)}
          disabled={!!availableLetters && !availableLetters.has(letter)}
        >
          {letter}
        </button>
      ))}
    </div>
  ),
}));

// Stand-in for the real virtualized grid (unit-tested separately in
// VirtualizedLibraryGrid.test.tsx). Exposes the imperative `scrollToIndex`
// handle and, mirroring the real grid's contract (prexu-6qi5.1), fires
// `onRangeChange` for the landing viewport whenever `scrollToIndex` is
// invoked — this is what lets these tests assert the jump actually requests
// the range it lands on, not just that it "scrolled".
const mockScrollToIndex = vi.fn();
vi.mock("../components/VirtualizedLibraryGrid", () => ({
  default: (props: {
    ref?: React.Ref<{ scrollToIndex: (index: number) => void }>;
    items: (unknown | undefined)[];
    itemCount?: number;
    renderItem: (item: never, index: number) => React.ReactNode;
    renderPlaceholder?: (index: number) => React.ReactNode;
    getKey: (item: never, index: number) => string;
    onRangeChange?: (start: number, end: number) => void;
    header?: React.ReactNode;
    footer?: React.ReactNode;
  }) => {
    const totalCount = props.itemCount ?? props.items.length;
    React.useImperativeHandle(props.ref, () => ({
      scrollToIndex: (index: number) => {
        mockScrollToIndex(index);
        const start = Math.max(0, index - 2);
        const end = Math.min(totalCount, index + 24);
        props.onRangeChange?.(start, end);
      },
    }));
    return (
      <div data-testid="virtualized-grid">
        {props.header}
        {Array.from({ length: totalCount }, (_, i) => {
          const item = props.items[i];
          return (
            <div key={item ? props.getKey(item as never, i) : `ph-${i}`} data-grid-index={i}>
              {item !== undefined
                ? props.renderItem(item as never, i)
                : (props.renderPlaceholder?.(i) ?? null)}
            </div>
          );
        })}
        {props.footer}
      </div>
    );
  },
}));

vi.mock("../components/SegmentedControl", () => ({
  default: ({
    options,
    value,
  }: {
    options: Array<{ label: string; value: string }>;
    value: string;
  }) => (
    <div data-testid="segmented-control">
      {options.map((o) => (
        <span key={o.value} data-active={o.value === value}>
          {o.label}
        </span>
      ))}
    </div>
  ),
}));

vi.mock("../components/EmptyState", () => ({
  default: ({ title }: { title: string }) => (
    <div data-testid="empty-state">{title}</div>
  ),
}));

vi.mock("../components/ErrorState", () => ({
  default: ({ message }: { message: string }) => (
    <div data-testid="error-state">{message}</div>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <LibraryView />
    </MemoryRouter>
  );
}

describe("LibraryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ sectionId: "1" });
    mockUseSearchParams.mockReturnValue([new URLSearchParams(), mockSetSearchParams]);
    // Re-prime — a PUSH override set by the timing-instrumentation suite
    // below must never leak into another suite's tests (prexu-5f12).
    mockUseNavigationType.mockReturnValue("POP");
    mockUseParentalControls.mockReturnValue({
      restrictionsEnabled: false,
      filterByRating: (items: unknown[]) => items,
      isItemAllowed: () => true,
      maxContentRating: "none",
    });
    // vi.clearAllMocks() clears call history but NOT mockReturnValue stubs —
    // re-prime so a persistent stub set by another suite (e.g. the
    // cross-filtered-facets suite below) never leaks in here.
    mockUseFilterOptions.mockReturnValue({
      genres: [],
      years: [],
      contentRatings: [],
      resolutions: [],
      isLoading: false,
    });
    // Mock IntersectionObserver globally as a class
    global.IntersectionObserver = vi.fn().mockImplementation(function (this: unknown) {
      (this as Record<string, unknown>).observe = vi.fn();
      (this as Record<string, unknown>).disconnect = vi.fn();
      (this as Record<string, unknown>).unobserve = vi.fn();
    }) as unknown as typeof IntersectionObserver;
  });

  it("renders library title from section", () => {
    mockUsePaginatedLibrary.mockReturnValue({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      totalSize: 0,
      error: null,
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Movies")).toBeInTheDocument();
  });

  it("renders SegmentedControl for movie sections", () => {
    mockUsePaginatedLibrary.mockReturnValue({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      totalSize: 0,
      error: null,
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("segmented-control")).toBeInTheDocument();
  });

  it("does not render SegmentedControl for show sections", () => {
    // Override useParams to return sectionId "2" (TV Shows)
    mockUseParams.mockReturnValue({ sectionId: "2" });

    mockUsePaginatedLibrary.mockReturnValue({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      totalSize: 0,
      error: null,
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    renderPage();
    expect(screen.queryByTestId("segmented-control")).not.toBeInTheDocument();
  });

  it("shows skeleton loading state", () => {
    mockUsePaginatedLibrary.mockReturnValue({
      items: [],
      isLoading: true,
      isLoadingMore: false,
      hasMore: false,
      totalSize: 0,
      error: null,
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    renderPage();
    const skeletons = screen.getAllByTestId("skeleton-card");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders poster cards for library items", () => {
    mockUsePaginatedLibrary.mockReturnValue({
      items: [
        { ratingKey: "100", title: "Inception", thumb: "/t1", type: "movie" },
        {
          ratingKey: "101",
          title: "The Matrix",
          thumb: "/t2",
          type: "movie",
        },
      ],
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      totalSize: 2,
      error: null,
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Inception")).toBeInTheDocument();
    expect(screen.getByText("The Matrix")).toBeInTheDocument();
  });

  it("dims the grid with aria-busy while showing stale items during a filter/sort refetch (prexu-0szx.18)", () => {
    mockUsePaginatedLibrary.mockReturnValue({
      items: [
        { ratingKey: "100", title: "Inception", thumb: "/t1", type: "movie" },
      ],
      isLoading: true,
      isLoadingMore: false,
      isStale: true,
      hasMore: false,
      totalSize: 1,
      error: null,
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    renderPage();

    // The previous item is still rendered, not blanked out...
    expect(screen.getByText("Inception")).toBeInTheDocument();
    // ...and the grid is marked busy for assistive tech / dimming.
    const busyRegion = document.querySelector('[aria-busy="true"]');
    expect(busyRegion).not.toBeNull();
  });

  it("renders a static restricted placeholder for fetched-but-disallowed items, loading skeleton only for unfetched slots (prexu-6qi5.1)", () => {
    mockUseParentalControls.mockReturnValue({
      restrictionsEnabled: true,
      filterByRating: (items: unknown[]) => items,
      isItemAllowed: (rating?: string) => rating !== "R",
      maxContentRating: "PG-13",
    });
    mockUsePaginatedLibrary.mockReturnValue({
      items: [
        { ratingKey: "100", title: "Allowed Movie", thumb: "/t1", type: "movie", contentRating: "PG" },
        { ratingKey: "101", title: "Blocked Movie", thumb: "/t2", type: "movie", contentRating: "R" },
        undefined, // unfetched slot (range not requested yet)
      ],
      isLoading: false,
      isLoadingMore: false,
      isStale: false,
      totalSize: 3,
      error: null,
      ensureRange: vi.fn(),
      retry: vi.fn(),
    });
    renderPage();

    // Allowed item renders normally.
    expect(screen.getByText("Allowed Movie")).toBeInTheDocument();
    // Fetched but disallowed: the item itself is masked...
    expect(screen.queryByText("Blocked Movie")).not.toBeInTheDocument();
    // ...and its slot renders the STATIC restricted placeholder — not the
    // shimmer skeleton, which would look permanently stuck loading.
    expect(screen.getByLabelText("Restricted content")).toBeInTheDocument();
    // The genuinely-unfetched slot still renders the loading skeleton.
    expect(screen.getAllByTestId("skeleton-card")).toHaveLength(1);
  });

  it("shows empty state when no items", () => {
    mockUsePaginatedLibrary.mockReturnValue({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      totalSize: 0,
      error: null,
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("shows error state", () => {
    mockUsePaginatedLibrary.mockReturnValue({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      totalSize: 0,
      error: "Failed to load library",
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("error-state")).toBeInTheDocument();
    expect(screen.getByText("Failed to load library")).toBeInTheDocument();
  });

  // ── Year ranges (prexu-6qi5.8) ──

  it("passes yearMin/yearMax from the URL through to usePaginatedLibrary's filters", () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams("yearMin=1980&yearMax=1989"),
      mockSetSearchParams,
    ]);
    mockUsePaginatedLibrary.mockReturnValue({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      isStale: false,
      totalSize: 0,
      error: null,
      ensureRange: vi.fn(),
      retry: vi.fn(),
    });

    renderPage();

    expect(mockUsePaginatedLibrary).toHaveBeenCalled();
    const filtersArg = mockUsePaginatedLibrary.mock.calls[0][2];
    expect(filtersArg).toMatchObject({ yearMin: "1980", yearMax: "1989" });
  });

  it("migrates a legacy single-year URL param to an exact yearMin/yearMax range", () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams("year=2005"),
      mockSetSearchParams,
    ]);
    mockUsePaginatedLibrary.mockReturnValue({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      isStale: false,
      totalSize: 0,
      error: null,
      ensureRange: vi.fn(),
      retry: vi.fn(),
    });

    renderPage();

    const filtersArg = mockUsePaginatedLibrary.mock.calls[0][2];
    expect(filtersArg).toMatchObject({ yearMin: "2005", yearMax: "2005" });
  });

  it("combines a year range with other active filters when building the fetch params", () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams("genre=Documentary&yearMin=1980&yearMax=1989&unwatched=1"),
      mockSetSearchParams,
    ]);
    mockUsePaginatedLibrary.mockReturnValue({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      isStale: false,
      totalSize: 0,
      error: null,
      ensureRange: vi.fn(),
      retry: vi.fn(),
    });

    renderPage();

    const filtersArg = mockUsePaginatedLibrary.mock.calls[0][2];
    expect(filtersArg).toMatchObject({
      genre: "Documentary",
      yearMin: "1980",
      yearMax: "1989",
      unwatched: true,
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Alpha-jump scrubber (prexu-6qi5.2)
//
// PR #55 gave VirtualizedLibraryGrid fixed, itemCount-driven geometry and a
// sparse-by-index item store, so an imperative scrollToIndex jump can reach
// ANY index — fetched or not — and onRangeChange fires for wherever it
// lands. These tests exercise the wiring end to end: LibraryView's
// handleAlphaJump computing the right target and the grid contract
// (mocked here, unit-tested in VirtualizedLibraryGrid.test.tsx) turning a
// jump into a range request.
function makeSparseItems(
  populatedPrefixLength: number,
  totalSize: number,
): (PlexTestItem | undefined)[] {
  return Array.from({ length: totalSize }, (_, i) =>
    i < populatedPrefixLength
      ? { ratingKey: String(i), title: `Item ${i}`, thumb: `/t${i}`, type: "movie" }
      : undefined,
  );
}

interface PlexTestItem {
  ratingKey: string;
  title: string;
  thumb: string;
  type: string;
  contentRating?: string;
}

describe("LibraryView — alpha jump scrubber (prexu-6qi5.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ sectionId: "1" });
    // vi.clearAllMocks() clears call history but NOT mockReturnValue stubs —
    // without this re-prime, the year-range URL tests in the suite above
    // leak their search params (genre/yearMin/yearMax/unwatched) into this
    // suite, which flips hasActiveFilters and disables the firstCharacter
    // fast path these tests exercise.
    mockUseSearchParams.mockReturnValue([new URLSearchParams(), mockSetSearchParams]);
    // Same leak concern as above (prexu-5f12).
    mockUseNavigationType.mockReturnValue("POP");
    mockUseParentalControls.mockReturnValue({
      restrictionsEnabled: false,
      filterByRating: (items: unknown[]) => items,
      isItemAllowed: () => true,
      maxContentRating: "none",
    });
    // Re-prime for the same reason as the suite above — a leaked stub here
    // would flip hasActiveFilters via a filters-arg side effect and disable
    // the firstCharacter fast path these tests exercise.
    mockUseFilterOptions.mockReturnValue({
      genres: [],
      years: [],
      contentRatings: [],
      resolutions: [],
      isLoading: false,
    });
  });

  it("single click on a letter whose offset lies far beyond the fetched range lands the viewport there and requests the landing range (hardware regression: clicking 'N' used to need ~20 clicks)", async () => {
    const { fireEvent } = await import("@testing-library/react");

    // Buckets chosen so "N" starts exactly at offset 2020 — the same
    // offset from the hardware repro's log line: alpha jump (firstChar)
    // {"letter":"N","offset":2020}.
    mockUseFirstCharacter.mockReturnValue({
      letters: new Set(["#", "A", "N", "Z"]),
      buckets: [
        { key: "#", size: 20 },
        { key: "A", size: 2000 },
        { key: "N", size: 50 },
        { key: "Z", size: 30 },
      ],
      isLoading: false,
      error: null,
    });

    const ensureRangeMock = vi.fn();
    mockUsePaginatedLibrary.mockReturnValue({
      // Only the first 100 items are fetched — index 2020 is well beyond
      // anything currently loaded, matching the repro's "grid creeping
      // forward 50 items per click" starting point.
      items: makeSparseItems(100, 2200),
      isLoading: false,
      isLoadingMore: false,
      isStale: false,
      totalSize: 2200,
      error: null,
      ensureRange: ensureRangeMock,
      retry: vi.fn(),
    });

    renderPage();

    const nButton = screen.getByRole("button", { name: "N" });
    expect(nButton).not.toBeDisabled();
    fireEvent.click(nButton);

    // A SINGLE click reaches the target directly — no repeated clicking.
    expect(mockScrollToIndex).toHaveBeenCalledTimes(1);
    expect(mockScrollToIndex).toHaveBeenCalledWith(2020);

    // The landing viewport gets its range requested (this is what makes the
    // jump self-healing: whatever becomes visible gets fetched).
    expect(ensureRangeMock).toHaveBeenCalledTimes(1);
    const [start, end] = ensureRangeMock.mock.calls[0]!;
    expect(start).toBeLessThanOrEqual(2020);
    expect(end).toBeGreaterThan(2020);

    // Log line shape is unchanged (tag, message, and payload).
    expect(mockLoggerDebug).toHaveBeenCalledWith(
      "library:scrubber",
      "alpha jump (firstChar)",
      { letter: "N", offset: 2020 },
    );
  });

  it("jump lands on the correct slot while the target range is still fetching, then fills in place once it resolves", async () => {
    const { fireEvent } = await import("@testing-library/react");

    mockUseFirstCharacter.mockReturnValue({
      letters: new Set(["#", "A", "N", "Z"]),
      buckets: [
        { key: "#", size: 20 },
        { key: "A", size: 2000 },
        { key: "N", size: 50 },
        { key: "Z", size: 30 },
      ],
      isLoading: false,
      error: null,
    });

    const ensureRangeMock = vi.fn();
    const baseReturn = {
      isLoading: false,
      isLoadingMore: false,
      isStale: false,
      totalSize: 2200,
      error: null,
      ensureRange: ensureRangeMock,
      retry: vi.fn(),
    };
    mockUsePaginatedLibrary.mockReturnValue({
      ...baseReturn,
      items: makeSparseItems(100, 2200),
    });

    const { rerender } = renderPage();

    // Before the jump, slot 2020 is unfetched -> renders a loading skeleton.
    const slotBefore = document.querySelector('[data-grid-index="2020"]');
    expect(slotBefore?.querySelector('[data-testid="skeleton-card"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "N" }));
    expect(mockScrollToIndex).toHaveBeenCalledWith(2020);
    expect(ensureRangeMock).toHaveBeenCalledTimes(1);

    // The range resolves and slot 2020 is now populated — simulate the
    // hook's state update and re-render the same tree (as React would).
    const filled = makeSparseItems(100, 2200);
    filled[2020] = { ratingKey: "2020", title: "Nightcrawler", thumb: "/t2020", type: "movie" };
    mockUsePaginatedLibrary.mockReturnValue({ ...baseReturn, items: filled });
    rerender(
      <MemoryRouter>
        <LibraryView />
      </MemoryRouter>,
    );

    const slotAfter = document.querySelector('[data-grid-index="2020"]');
    expect(slotAfter?.querySelector('[data-testid="skeleton-card"]')).toBeNull();
    expect(slotAfter?.textContent).toBe("Nightcrawler");
  });

  it("fallback path (firstCharacter unavailable) scans only populated slots of the sparse store for the matching bucket", async () => {
    const { fireEvent } = await import("@testing-library/react");

    // Simulate the firstCharacter endpoint failing -> useFirstCharIndex is
    // false, so handleAlphaJump takes the linear-scan fallback branch.
    mockUseFirstCharacter.mockReturnValue({
      letters: new Set<string>(),
      buckets: [],
      isLoading: false,
      error: "Failed to load first-character index",
    });

    const ensureRangeMock = vi.fn();
    mockUsePaginatedLibrary.mockReturnValue({
      items: [
        { ratingKey: "1", title: "Alien", thumb: "/t1", type: "movie" },
        undefined, // unfetched slot — must be skipped, not treated as a miss
        { ratingKey: "3", title: "The Matrix", thumb: "/t3", type: "movie" },
      ],
      isLoading: false,
      isLoadingMore: false,
      isStale: false,
      totalSize: 3,
      error: null,
      ensureRange: ensureRangeMock,
      retry: vi.fn(),
    });

    renderPage();

    // Only buckets actually present in the loaded (sparse) items are
    // enabled — "A" (Alien) and "M" (The Matrix).
    const mButton = screen.getByRole("button", { name: "M" });
    expect(mButton).not.toBeDisabled();

    fireEvent.click(mButton);

    // Index 2 ("The Matrix") is found, skipping over the unfetched hole
    // at index 1 rather than misreading it as a bucket mismatch.
    expect(mockScrollToIndex).toHaveBeenCalledWith(2);
    expect(mockLoggerDebug).toHaveBeenCalledWith("library:scrubber", "alpha jump", {
      letter: "M",
      index: 2,
      title: "The Matrix",
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Client-side cross-filtered filter options (prexu-hb1p)
//
// PR #55's loadAll background fill means a filtered view eventually holds
// the ENTIRE filtered result set in memory. These tests exercise the wiring
// end to end: LibraryView composing usePaginatedLibrary's isFillComplete +
// useFilterOptions' server option lists through useConstrainedFilterOptions
// and down into FilterBar's props (the mocked FilterBar above renders the
// option keys it received so they can be asserted on directly).
const serverGenres = [
  { key: "documentary", title: "Documentary" },
  { key: "comedy", title: "Comedy" },
];
const serverYears = [
  { key: "2020", title: "2020" },
  { key: "1999", title: "1999" },
  { key: "1985", title: "1985" },
];
const serverContentRatings = [
  { key: "PG-13", title: "PG-13" },
  { key: "R", title: "R" },
];
const serverResolutions = [
  { key: "1080", title: "1080p" },
  { key: "4k", title: "4K" },
];

// Simulates a genre=Documentary filtered result set: only years 1999/2020,
// only PG-13, only 1080p actually occur in it.
const documentaryItems = [
  {
    ratingKey: "1",
    title: "Doc One",
    thumb: "/t1",
    type: "movie",
    year: 1999,
    contentRating: "PG-13",
    Media: [{ videoResolution: "1080" }],
    Genre: [{ tag: "Documentary" }],
  },
  {
    ratingKey: "2",
    title: "Doc Two",
    thumb: "/t2",
    type: "movie",
    year: 2020,
    contentRating: "PG-13",
    Media: [{ videoResolution: "1080" }],
    Genre: [{ tag: "Documentary" }],
  },
];

describe("LibraryView — cross-filtered facets (prexu-hb1p)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ sectionId: "1" });
    // Same leak concern noted in the suites above (prexu-5f12).
    mockUseNavigationType.mockReturnValue("POP");
    mockUseParentalControls.mockReturnValue({
      restrictionsEnabled: false,
      filterByRating: (items: unknown[]) => items,
      isItemAllowed: () => true,
      maxContentRating: "none",
    });
    mockUseFilterOptions.mockReturnValue({
      genres: serverGenres,
      years: serverYears,
      contentRatings: serverContentRatings,
      resolutions: serverResolutions,
      isLoading: false,
    });
  });

  it("narrows dropdowns without an active selection once the fill completes, but keeps the full list for the dropdown that IS set", () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams("genre=documentary"),
      mockSetSearchParams,
    ]);
    mockUsePaginatedLibrary.mockReturnValue({
      items: documentaryItems,
      isLoading: false,
      isLoadingMore: false,
      isStale: false,
      totalSize: documentaryItems.length,
      isFillComplete: true,
      error: null,
      ensureRange: vi.fn(),
      retry: vi.fn(),
    });

    renderPage();

    // Genre has an active selection ("documentary") -> full server list kept.
    expect(screen.getByTestId("filter-bar-genres").textContent).toBe("documentary,comedy");
    // Year/contentRating/resolution have no active selection -> narrowed to
    // only the values present in the Documentary-filtered result set. Server
    // list order is preserved (2020, 1999, 1985 -> 2020, 1999).
    expect(screen.getByTestId("filter-bar-years").textContent).toBe("2020,1999");
    expect(screen.getByTestId("filter-bar-content-ratings").textContent).toBe("PG-13");
    expect(screen.getByTestId("filter-bar-resolutions").textContent).toBe("1080");
  });

  it("does not narrow options while the background fill is still in progress", () => {
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams("genre=documentary"),
      mockSetSearchParams,
    ]);
    mockUsePaginatedLibrary.mockReturnValue({
      items: documentaryItems, // only a partial prefix loaded so far
      isLoading: false,
      isLoadingMore: true,
      isStale: false,
      totalSize: 50, // full filtered result set is bigger than what's loaded
      isFillComplete: false,
      error: null,
      ensureRange: vi.fn(),
      retry: vi.fn(),
    });

    renderPage();

    // No narrowing yet — full server lists shown for every dropdown.
    expect(screen.getByTestId("filter-bar-years").textContent).toBe("2020,1999,1985");
    expect(screen.getByTestId("filter-bar-content-ratings").textContent).toBe("PG-13,R");
    expect(screen.getByTestId("filter-bar-resolutions").textContent).toBe("1080,4k");
  });

  it("leaves options unchanged when no filter is active, regardless of fill state", () => {
    mockUseSearchParams.mockReturnValue([new URLSearchParams(), mockSetSearchParams]);
    mockUsePaginatedLibrary.mockReturnValue({
      items: documentaryItems,
      isLoading: false,
      isLoadingMore: false,
      isStale: false,
      totalSize: documentaryItems.length,
      isFillComplete: true,
      error: null,
      ensureRange: vi.fn(),
      retry: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("filter-bar-years").textContent).toBe("2020,1999,1985");
    expect(screen.getByTestId("filter-bar-genres").textContent).toBe("documentary,comedy");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Route-transition timing / cheap first commit (prexu-5f12)
//
// React Router v7 wraps every navigation's state update in
// React.startTransition, so the OLD route stays visible until LibraryView's
// first render commits. The hardware bug report was POP-specific (browser
// back button from a detail page): the destination URL restores the exact
// previous sort/filters, so usePaginatedLibrary's cache-hit branch used to
// apply the full cached store synchronously on the very first pass. PUSH
// (e.g. the sidebar library link) starts without those URL params, missing
// the cache on its first pass, which incidentally gave the browser a paint
// window PUSH didn't need to earn. These tests assert LibraryView's half of
// the fix: the frame commits and renders identically regardless of how much
// data usePaginatedLibrary reports having, and the new timing markers carry
// the navigation action so a hardware run can show which path is slow.
// usePaginatedLibrary's own half (deferring a cache hit by one animation
// frame) is unit-tested directly in usePaginatedLibrary.test.ts.
describe("LibraryView — route-transition timing instrumentation (prexu-5f12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ sectionId: "1" });
    mockUseSearchParams.mockReturnValue([new URLSearchParams(), mockSetSearchParams]);
    mockUseNavigationType.mockReturnValue("POP");
    mockUseParentalControls.mockReturnValue({
      restrictionsEnabled: false,
      filterByRating: (items: unknown[]) => items,
      isItemAllowed: () => true,
      maxContentRating: "none",
    });
    mockUseFilterOptions.mockReturnValue({
      genres: [],
      years: [],
      contentRatings: [],
      resolutions: [],
      isLoading: false,
    });
    global.IntersectionObserver = vi.fn().mockImplementation(function (this: unknown) {
      (this as Record<string, unknown>).observe = vi.fn();
      (this as Record<string, unknown>).disconnect = vi.fn();
      (this as Record<string, unknown>).unobserve = vi.fn();
    }) as unknown as typeof IntersectionObserver;
  });

  const pendingLibraryState = {
    items: [] as unknown[],
    isLoading: true,
    isLoadingMore: false,
    isStale: false,
    totalSize: 0,
    error: null,
    ensureRange: vi.fn(),
    retry: vi.fn(),
  };

  it("renders the skeleton frame synchronously on a POP mount even while usePaginatedLibrary is still empty (no blocking on chunk fetches)", () => {
    mockUseNavigationType.mockReturnValue("POP");
    mockUsePaginatedLibrary.mockReturnValue(pendingLibraryState);

    renderPage();

    // The frame (filter bar) and grid skeleton are both already in the DOM
    // on the very first render — nothing here waits on a chunk fetch to
    // resolve, so this is what the transition commits on.
    expect(screen.getByTestId("filter-bar")).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton-card").length).toBeGreaterThan(0);
  });

  it("renders the identical frame on a PUSH mount (unchanged behavior)", () => {
    mockUseNavigationType.mockReturnValue("PUSH");
    mockUsePaginatedLibrary.mockReturnValue(pendingLibraryState);

    renderPage();

    expect(screen.getByTestId("filter-bar")).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton-card").length).toBeGreaterThan(0);
  });

  it.each([["POP"], ["PUSH"]] as const)(
    "logs route entry start and first commit tagged with the %s navigation action",
    (action) => {
      mockUseNavigationType.mockReturnValue(action);
      mockUsePaginatedLibrary.mockReturnValue(pendingLibraryState);

      renderPage();

      expect(mockLoggerDebug).toHaveBeenCalledWith(
        "library",
        "route entry start",
        expect.objectContaining({ action, sectionId: "1" }),
      );
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        "library",
        "first commit",
        expect.objectContaining({ action, ms: expect.any(Number) }),
      );
    },
  );

  it("logs sparse store ready exactly once, tagged with the navigation action, the first time totalSize becomes known", () => {
    mockUseNavigationType.mockReturnValue("POP");
    mockUsePaginatedLibrary.mockReturnValue(pendingLibraryState);

    const { rerender } = renderPage();

    expect(mockLoggerDebug).not.toHaveBeenCalledWith(
      "library",
      "sparse store ready",
      expect.anything(),
    );

    mockUsePaginatedLibrary.mockReturnValue({
      ...pendingLibraryState,
      items: [{ ratingKey: "1", title: "Inception", thumb: "/t1", type: "movie" }],
      isLoading: false,
      totalSize: 500,
    });
    rerender(
      <MemoryRouter>
        <LibraryView />
      </MemoryRouter>,
    );

    expect(mockLoggerDebug).toHaveBeenCalledWith(
      "library",
      "sparse store ready",
      expect.objectContaining({ action: "POP", totalSize: 500, populated: 1 }),
    );

    // A further rerender (e.g. more chunks filling in) must not re-log it.
    mockLoggerDebug.mockClear();
    mockUsePaginatedLibrary.mockReturnValue({
      ...pendingLibraryState,
      items: [
        { ratingKey: "1", title: "Inception", thumb: "/t1", type: "movie" },
        { ratingKey: "2", title: "The Matrix", thumb: "/t2", type: "movie" },
      ],
      isLoading: false,
      totalSize: 500,
    });
    rerender(
      <MemoryRouter>
        <LibraryView />
      </MemoryRouter>,
    );
    expect(mockLoggerDebug).not.toHaveBeenCalledWith(
      "library",
      "sparse store ready",
      expect.anything(),
    );
  });

  it("wires useScrollRestoration with an onRestore callback that logs the restored offset tagged with the navigation action", () => {
    mockUseNavigationType.mockReturnValue("PUSH");
    mockUsePaginatedLibrary.mockReturnValue(pendingLibraryState);

    renderPage();

    expect(mockUseScrollRestoration).toHaveBeenCalledWith(
      expect.objectContaining({ onRestore: expect.any(Function) }),
    );

    // Simulate the restoration hook actually landing the saved offset —
    // exercised here rather than in useScrollRestoration's own tests since
    // the callback's log line is LibraryView's responsibility.
    const { onRestore } = mockUseScrollRestoration.mock.calls[0][0] as {
      onRestore: (info: { restoredTo: number }) => void;
    };
    mockLoggerDebug.mockClear();
    onRestore({ restoredTo: 4200 });

    expect(mockLoggerDebug).toHaveBeenCalledWith(
      "library",
      "scroll restoration applied",
      expect.objectContaining({ action: "PUSH", restoredTo: 4200, ms: expect.any(Number) }),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// PosterCard callback identity stability (prexu-9f4s.1)
//
// renderLibraryItem used to pass fresh inline arrows
// (onClick/onContextMenu/onMoreClick/onExpand) to PosterCard on every grid
// render, minting a new identity per render and defeating PosterCard's
// React.memo across the whole virtualized grid. The fix routes those through
// useStableItemCallback (one cached handler per ratingKey). These tests assert
// the SAME handler references survive across repeated page/grid re-renders for
// an unchanged item — and would fail if the inline arrows were restored.
describe("LibraryView — PosterCard callback identity stability (prexu-9f4s.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ sectionId: "1" });
    mockUseSearchParams.mockReturnValue([new URLSearchParams(), mockSetSearchParams]);
    mockUseNavigationType.mockReturnValue("POP");
    mockUseParentalControls.mockReturnValue({
      restrictionsEnabled: false,
      filterByRating: (items: unknown[]) => items,
      isItemAllowed: () => true,
      maxContentRating: "none",
    });
    mockUseFilterOptions.mockReturnValue({
      genres: [],
      years: [],
      contentRatings: [],
      resolutions: [],
      isLoading: false,
    });
    // Reset the shared capture map + per-key play-handler cache so snapshots
    // from other suites (which also render ratingKey "100") don't leak in.
    for (const key of Object.keys(mockCapturedPosterProps)) {
      delete mockCapturedPosterProps[key];
    }
    mockPlayHandlers.clear();
    global.IntersectionObserver = vi.fn().mockImplementation(function (this: unknown) {
      (this as Record<string, unknown>).observe = vi.fn();
      (this as Record<string, unknown>).disconnect = vi.fn();
      (this as Record<string, unknown>).unobserve = vi.fn();
    }) as unknown as typeof IntersectionObserver;
  });

  it("passes stable onClick/onPlay/onContextMenu/onMoreClick identities to PosterCard across grid re-renders", () => {
    mockUsePaginatedLibrary.mockReturnValue({
      items: [{ ratingKey: "100", title: "Inception", thumb: "/t1", type: "movie" }],
      isLoading: false,
      isLoadingMore: false,
      isStale: false,
      totalSize: 1,
      error: null,
      ensureRange: vi.fn(),
      loadMore: vi.fn(),
      retry: vi.fn(),
    });

    const { rerender } = renderPage();
    // Force the whole page (and therefore the grid's renderItem) to run again
    // twice, mimicking unrelated re-renders, without changing the item.
    rerender(
      <MemoryRouter>
        <LibraryView />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <LibraryView />
      </MemoryRouter>,
    );

    const snaps = mockCapturedPosterProps["100"];
    expect(snaps.length).toBeGreaterThanOrEqual(3);

    const first = snaps[0]!;
    expect(typeof first.onClick).toBe("function");
    expect(typeof first.onPlay).toBe("function");
    expect(typeof first.onContextMenu).toBe("function");
    expect(typeof first.onMoreClick).toBe("function");

    for (const snap of snaps) {
      expect(snap.onClick).toBe(first.onClick);
      expect(snap.onPlay).toBe(first.onPlay);
      expect(snap.onContextMenu).toBe(first.onContextMenu);
      expect(snap.onMoreClick).toBe(first.onMoreClick);
    }
  });
});
