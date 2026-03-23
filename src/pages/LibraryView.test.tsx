import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LibraryView from "./LibraryView";

const mockUseParams = vi.fn(() => ({ sectionId: "1" }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => mockUseParams(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
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

vi.mock("../hooks/useParentalControls", () => ({
  useParentalControls: () => ({
    restrictionsEnabled: false,
    filterByRating: (items: unknown[]) => items,
    isItemAllowed: () => true,
    maxContentRating: "none",
  }),
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
});
