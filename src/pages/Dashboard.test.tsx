import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://plex.test", accessToken: "token" },
  }),
}));

const mockUsePreferences = vi.fn();
vi.mock("../hooks/usePreferences", () => ({
  usePreferences: () => mockUsePreferences(),
}));

const defaultPrefs = () => ({
  preferences: {
    playback: {},
    appearance: {
      posterSize: "medium" as const,
      sidebarCollapsed: false,
      skipSingleSeason: true,
      dashboardSections: {
        continueWatching: true,
        recentMovies: true,
        recentShows: true,
      },
    },
  },
  updatePreferences: vi.fn(),
});

const mockUseDashboard = vi.fn();
vi.mock("../hooks/useDashboard", () => ({
  useDashboard: () => mockUseDashboard(),
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

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => "desktop",
  isMobile: () => false,
}));

vi.mock("../services/plex-library", () => ({
  getImageUrl: vi.fn(() => "http://img.test/poster.jpg"),
  markAsWatched: vi.fn(() => Promise.resolve()),
}));

vi.mock("../services/storage", () => ({
  getDismissedRecommendations: vi.fn(() => Promise.resolve([])),
  saveDismissedRecommendations: vi.fn(),
}));

vi.mock("../utils/media-helpers", () => ({
  getMediaSubtitleShort: vi.fn(() => "2023"),
  getProgress: vi.fn(() => 0),
  isWatched: vi.fn(() => false),
}));

vi.mock("../components/HeroSlideshow", () => ({
  default: () => <div data-testid="hero-slideshow" />,
}));

vi.mock("../components/EpisodeExpander", () => ({
  default: () => <div data-testid="episode-expander" />,
}));

vi.mock("../components/HorizontalRow", () => ({
  default: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <div data-testid={`row-${title}`}>
      <h3>{title}</h3>
      {children}
    </div>
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
  default: ({
    message,
    onRetry,
  }: {
    message: string;
    onRetry?: () => void;
  }) => (
    <div data-testid="error-state">
      <span>{message}</span>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  ),
}));

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

const makeDashboardData = (
  overrides: Partial<{
    recentMovies: Array<{
      ratingKey: string;
      title: string;
      thumb: string;
      type: string;
    }>;
    recentShows: Array<{
      groupKey: string;
      title: string;
      thumb: string;
      kind: string;
      episodeCount: number;
      episodes: unknown[];
      seasonIndices: number[];
      representativeItem: unknown;
    }>;
    onDeck: Array<{
      ratingKey: string;
      title: string;
      thumb: string;
      type: string;
    }>;
    isLoading: boolean;
    error: string | null;
    refresh: () => void;
  }>
) => ({
  recentMovies: [],
  recentShows: [],
  onDeck: [],
  isLoading: false,
  error: null,
  refresh: vi.fn(),
  ...overrides,
});

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePreferences.mockReturnValue(defaultPrefs());
  });

  it("renders loading skeletons when loading", () => {
    mockUseDashboard.mockReturnValue(makeDashboardData({ isLoading: true }));
    renderDashboard();
    const skeletons = screen.getAllByTestId("skeleton-card");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders 'Continue Watching' section when onDeck has items", () => {
    mockUseDashboard.mockReturnValue(
      makeDashboardData({
        onDeck: [
          { ratingKey: "1", title: "Breaking Bad", thumb: "/t1", type: "episode" },
        ],
      })
    );
    renderDashboard();
    expect(screen.getByText("Continue Watching")).toBeInTheDocument();
  });

  it("renders 'Recently Added in Movies' section", () => {
    mockUseDashboard.mockReturnValue(
      makeDashboardData({
        recentMovies: [
          { ratingKey: "10", title: "Inception", thumb: "/t10", type: "movie" },
        ],
      })
    );
    renderDashboard();
    expect(screen.getByText("Recently Added in Movies")).toBeInTheDocument();
    expect(screen.getByText("Inception")).toBeInTheDocument();
  });

  it("renders 'Recently Added in TV Shows' section", () => {
    mockUseDashboard.mockReturnValue(
      makeDashboardData({
        recentShows: [
          {
            groupKey: "20",
            title: "Stranger Things",
            thumb: "/t20",
            kind: "show-group",
            episodeCount: 3,
            episodes: [],
            seasonIndices: [],
            representativeItem: {
              ratingKey: "20",
              title: "Stranger Things",
              thumb: "/t20",
              type: "show",
            },
          },
        ],
      })
    );
    renderDashboard();
    expect(screen.getByText("Recently Added in TV Shows")).toBeInTheDocument();
    expect(screen.getByText("Stranger Things")).toBeInTheDocument();
  });

  it("shows error state on error", () => {
    mockUseDashboard.mockReturnValue(
      makeDashboardData({ error: "Failed to load dashboard" })
    );
    renderDashboard();
    expect(screen.getByTestId("error-state")).toBeInTheDocument();
    expect(screen.getByText("Failed to load dashboard")).toBeInTheDocument();
  });

  it("shows empty state when no content", () => {
    mockUseDashboard.mockReturnValue(makeDashboardData({}));
    renderDashboard();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
  });

  it("hides Continue Watching section when dashboardSections.continueWatching is false", () => {
    mockUsePreferences.mockReturnValue({
      preferences: {
        playback: {},
        appearance: {
          posterSize: "medium" as const,
          sidebarCollapsed: false,
          skipSingleSeason: true,
          dashboardSections: {
            continueWatching: false,
            recentMovies: true,
            recentShows: true,
          },
        },
      },
      updatePreferences: vi.fn(),
    });

    mockUseDashboard.mockReturnValue(
      makeDashboardData({
        onDeck: [
          { ratingKey: "1", title: "Breaking Bad", thumb: "/t1", type: "episode" },
        ],
      })
    );
    renderDashboard();
    expect(screen.queryByText("Continue Watching")).not.toBeInTheDocument();
  });
});
