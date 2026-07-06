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
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => mockUseParams(),
    useSearchParams: () => mockUseSearchParams(),
    useNavigate: () => vi.fn(),
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

vi.mock("../hooks/useFilterOptions", () => ({
  useFilterOptions: () => ({
    genres: [],
    years: [],
    contentRatings: [],
    resolutions: [],
    isLoading: false,
  }),
}));

vi.mock("../hooks/useMediaContextMenu", () => ({
  useMediaContextMenu: () => ({ openContextMenu: vi.fn(), overlays: null }),
}));

vi.mock("../hooks/usePlayAction", () => ({
  usePlayAction: () => ({
    getPlayHandler: vi.fn(() => undefined),
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

vi.mock("../hooks/useScrollRestoration", () => ({
  useScrollRestoration: vi.fn(),
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


vi.mock("../components/FilterBar", () => ({
  default: () => <div data-testid="filter-bar" />,
}));

vi.mock("../components/PosterCard", () => ({
  default: ({ title }: { title: string }) => (
    <div data-testid="poster-card">{title}</div>
  ),
}));

vi.mock("../components/SkeletonCard", () => ({
  default: () => <div data-testid="skeleton-card" />,
}));

vi.mock("../components/ShowExpansionPanel", () => ({
  default: () => <div data-testid="show-expansion-panel" />,
}));

vi.mock("../components/AlphaJumpBar", () => ({
  default: () => <div data-testid="alpha-jump-bar" />,
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
    mockUseParentalControls.mockReturnValue({
      restrictionsEnabled: false,
      filterByRating: (items: unknown[]) => items,
      isItemAllowed: () => true,
      maxContentRating: "none",
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
