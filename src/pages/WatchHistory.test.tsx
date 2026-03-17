import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WatchHistory from "./WatchHistory";

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://plex.test", accessToken: "token" },
  }),
}));

const mockUseWatchHistory = vi.fn();
vi.mock("../hooks/useWatchHistory", () => ({
  useWatchHistory: () => mockUseWatchHistory(),
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

vi.mock("../services/plex-library", () => ({
  getImageUrl: vi.fn(() => "http://img.test/poster.jpg"),
}));

vi.mock("../utils/media-helpers", () => ({
  getMediaTitle: vi.fn((item: { title: string }) => item.title),
  getMediaSubtitle: vi.fn(() => "2023"),
  getMediaPoster: vi.fn(() => "/thumb"),
  getProgress: vi.fn(() => 0),
  isWatched: vi.fn(() => true),
}));

vi.mock("../components/LibraryGrid", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="library-grid">{children}</div>
  ),
}));

vi.mock("../components/PosterCard", () => ({
  default: ({ title }: { title: string }) => (
    <div data-testid="poster-card">{title}</div>
  ),
}));

vi.mock("../components/SkeletonCard", () => ({
  default: () => <div data-testid="skeleton-card" />,
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
      <WatchHistory />
    </MemoryRouter>
  );
}

describe("WatchHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock IntersectionObserver globally as a class
    global.IntersectionObserver = vi.fn().mockImplementation(function (this: unknown) {
      (this as Record<string, unknown>).observe = vi.fn();
      (this as Record<string, unknown>).disconnect = vi.fn();
      (this as Record<string, unknown>).unobserve = vi.fn();
    }) as unknown as typeof IntersectionObserver;
  });

  it("renders 'Watch History' heading", () => {
    mockUseWatchHistory.mockReturnValue({
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
    expect(screen.getByText("Watch History")).toBeInTheDocument();
  });

  it("shows skeleton loading state", () => {
    mockUseWatchHistory.mockReturnValue({
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

  it("renders watch history items", () => {
    mockUseWatchHistory.mockReturnValue({
      items: [
        { ratingKey: "1", title: "Movie One", thumb: "/t1", type: "movie" },
        { ratingKey: "2", title: "Movie Two", thumb: "/t2", type: "movie" },
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
    expect(screen.getByText("Movie One")).toBeInTheDocument();
    expect(screen.getByText("Movie Two")).toBeInTheDocument();
  });

  it("shows total count", () => {
    mockUseWatchHistory.mockReturnValue({
      items: [
        { ratingKey: "1", title: "Movie One", thumb: "/t1", type: "movie" },
      ],
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      totalSize: 42,
      error: null,
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("42 watched")).toBeInTheDocument();
  });

  it("shows empty state when no items", () => {
    mockUseWatchHistory.mockReturnValue({
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
    expect(screen.getByText("No watch history")).toBeInTheDocument();
  });

  it("shows error state", () => {
    mockUseWatchHistory.mockReturnValue({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      totalSize: 0,
      error: "Failed to load watch history",
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId("error-state")).toBeInTheDocument();
    expect(
      screen.getByText("Failed to load watch history")
    ).toBeInTheDocument();
  });
});
