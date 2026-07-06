import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

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

// Dashboard's staged shelf reveal (prexu-200v) advances one stage per
// `requestAnimationFrame` tick, chaining the next stage's rAF from inside
// the previous one's callback (see Dashboard.tsx). jsdom's real rAF is
// timer-backed and won't fire synchronously within `render()`'s act() flush,
// so tests need a manual, synchronously-flushable queue — same pattern as
// VirtualizedLibraryGrid.test.tsx's `flushRaf` (prexu-k2mv: a shared real
// rAF queue across tests leaks pending callbacks between them).
let rafQueue: FrameRequestCallback[] = [];
function flushRaf() {
  const queue = rafQueue;
  rafQueue = [];
  for (const cb of queue) cb(0);
}
/** Drains the full deck -> movies -> shows chain (each flush only advances
 *  one stage and re-queues the next; looping past 3 is a harmless no-op). */
function advanceAllShelfStages() {
  act(() => {
    for (let i = 0; i < 4; i++) flushRaf();
  });
}

// Lets a single test freeze the component at its very first commit — i.e.
// before any passive effect runs — to assert on the two-phase mount
// (prexu-r56j). Real `act()`/render() flushes passive effects synchronously
// before returning, so there's no way to observe the pre-effect DOM through
// the normal render() flow; this substitutes React's `useEffect` with a
// version that's a no-op while the flag is set. Reading/writing a property
// on `globalThis` (rather than a module-scope variable) sidesteps Vitest's
// restriction on referencing outer bindings from inside a `vi.mock` factory.
declare global {
  // eslint-disable-next-line no-var
  var __suppressReactEffectsForTest__: boolean | undefined;
}
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (...args: Parameters<typeof actual.useEffect>) => {
      if (globalThis.__suppressReactEffectsForTest__) return undefined;
      return actual.useEffect(...args);
    },
  };
});

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://plex.test", accessToken: "token" },
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

vi.mock("../contexts/PlayerContext", () => ({
  usePlayerSession: () => ({
    session: null,
    play: vi.fn(),
    stop: vi.fn(),
    replaceRatingKey: vi.fn(),
    updateSession: vi.fn(),
  }),
}));

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => "desktop",
  isMobile: () => false,
}));

vi.mock("../services/plex-library", () => ({
  getImageUrl: vi.fn(() => "http://img.test/poster.jpg"),
  getPlaceholderUrl: vi.fn(() => "http://img.test/placeholder.jpg"),
  getImageSrcSet: vi.fn(() => ""),
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

/**
 * Renders Dashboard. By default fully drains the staged shelf reveal so
 * existing assertions (written against PR #62's single `shelvesReady` flip)
 * keep observing "everything settled" behavior without each needing its own
 * flush call. Tests that specifically assert on the staged, in-between
 * states pass `advanceStages: false` and flush manually with `flushRaf()`.
 */
function renderDashboard({ advanceStages = true }: { advanceStages?: boolean } = {}) {
  const result = render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
  if (advanceStages) {
    advanceAllShelfStages();
  }
  return result;
}

type LoadingMap = { movies: boolean; shows: boolean; deck: boolean };
type ErrorMap = { movies: string | null; shows: string | null; deck: string | null };

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
    loading: LoadingMap;
    errors: ErrorMap;
    refresh: (section?: string) => void;
  }>
) => ({
  recentMovies: [],
  recentShows: [],
  onDeck: [],
  loading: { movies: false, shows: false, deck: false } as LoadingMap,
  errors: { movies: null, shows: null, deck: null } as ErrorMap,
  refresh: vi.fn(),
  ...overrides,
});

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePreferences.mockReturnValue(defaultPrefs());
    // Re-primed every test (not just reset by clearAllMocks, which strips
    // call history but not a previously-installed mockImplementation) so
    // each test gets its own empty, test-scoped rAF queue — see the
    // `flushRaf` comment above for why a shared real rAF queue is unsafe.
    rafQueue = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        rafQueue.push(cb);
        return rafQueue.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("renders loading skeletons when all sections are loading", () => {
    mockUseDashboard.mockReturnValue(
      makeDashboardData({
        loading: { movies: true, shows: true, deck: true },
      }),
    );
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

  it("shows inline section error with Retry when one section errors", () => {
    const refresh = vi.fn();
    mockUseDashboard.mockReturnValue(
      makeDashboardData({
        errors: { movies: null, shows: null, deck: "Continue Watching timed out" },
        refresh,
      }),
    );
    renderDashboard();
    expect(screen.getByText("Continue Watching timed out")).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: /retry/i });
    retryButton.click();
    expect(refresh).toHaveBeenCalledWith("deck");
  });

  it("renders other sections normally when one section errors", () => {
    mockUseDashboard.mockReturnValue(
      makeDashboardData({
        recentMovies: [
          { ratingKey: "1", title: "Inception", thumb: "/t1", type: "movie" },
        ],
        errors: { movies: null, shows: null, deck: "Deck timed out" },
      }),
    );
    renderDashboard();
    expect(screen.getByText("Inception")).toBeInTheDocument();
    expect(screen.getByText("Deck timed out")).toBeInTheDocument();
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

  describe("two-phase mount (prexu-r56j)", () => {
    it("shows skeletons on the very first commit even with a fully warm cache", () => {
      // Warm cache: every section already has data and nothing is "loading" —
      // pre-fix this rendered real shelves (all PosterCards) on the very
      // first commit. Suppress useEffect so the render is frozen at that
      // first commit, before the `shelvesReady` effect can flip it.
      mockUseDashboard.mockReturnValue(
        makeDashboardData({
          onDeck: [
            { ratingKey: "1", title: "Breaking Bad", thumb: "/t1", type: "episode" },
          ],
          recentMovies: [
            { ratingKey: "10", title: "Inception", thumb: "/t10", type: "movie" },
          ],
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
        }),
      );

      globalThis.__suppressReactEffectsForTest__ = true;
      try {
        renderDashboard();

        // First commit must be the cheap skeleton frame, not the real shelves —
        // this is the commit React Router's startTransition waits on.
        expect(screen.queryAllByTestId("skeleton-card").length).toBeGreaterThan(0);
        expect(screen.queryByText("Breaking Bad")).not.toBeInTheDocument();
        expect(screen.queryByText("Inception")).not.toBeInTheDocument();
        expect(screen.queryByText("Stranger Things")).not.toBeInTheDocument();
        expect(screen.queryAllByTestId("poster-card").length).toBe(0);
      } finally {
        globalThis.__suppressReactEffectsForTest__ = false;
      }
    });

    it("renders the real shelves once effects flush after the first commit", () => {
      // Same warm-cache data as above, but this time effects run normally
      // (no spy) — matches PR #54's existing assertions that real content
      // renders after render()/act() settle.
      mockUseDashboard.mockReturnValue(
        makeDashboardData({
          onDeck: [
            { ratingKey: "1", title: "Breaking Bad", thumb: "/t1", type: "episode" },
          ],
        }),
      );
      renderDashboard();

      expect(screen.getByText("Breaking Bad")).toBeInTheDocument();
      expect(screen.queryAllByTestId("skeleton-card").length).toBe(0);
    });
  });

  describe("staged shelf reveal (prexu-200v)", () => {
    // Same fully warm-cache dataset for all three tests below — every
    // section already has data and nothing is "loading", so any remaining
    // skeleton is purely due to that section's stage not having arrived yet,
    // not the loading flags.
    const warmCacheData = () =>
      makeDashboardData({
        onDeck: [
          { ratingKey: "1", title: "Breaking Bad", thumb: "/t1", type: "episode" },
        ],
        recentMovies: [
          { ratingKey: "10", title: "Inception", thumb: "/t10", type: "movie" },
        ],
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
      });

    it("commits the deck shelf first, while movies and shows are still skeletons", () => {
      mockUseDashboard.mockReturnValue(warmCacheData());
      renderDashboard({ advanceStages: false });

      // Before any stage advances, all three sections are skeletons.
      expect(screen.queryAllByTestId("skeleton-card").length).toBe(24);

      act(() => flushRaf()); // deck stage only

      expect(screen.getByText("Breaking Bad")).toBeInTheDocument();
      expect(screen.queryByText("Inception")).not.toBeInTheDocument();
      expect(screen.queryByText("Stranger Things")).not.toBeInTheDocument();
      // Deck's 8 skeletons are gone; movies' and shows' 8 each remain.
      expect(screen.queryAllByTestId("skeleton-card").length).toBe(16);
    });

    it("commits the movies shelf next, after deck and before shows", () => {
      mockUseDashboard.mockReturnValue(warmCacheData());
      renderDashboard({ advanceStages: false });

      act(() => flushRaf()); // deck
      act(() => flushRaf()); // movies

      expect(screen.getByText("Breaking Bad")).toBeInTheDocument();
      expect(screen.getByText("Inception")).toBeInTheDocument();
      expect(screen.queryByText("Stranger Things")).not.toBeInTheDocument();
      expect(screen.queryAllByTestId("skeleton-card").length).toBe(8);
    });

    it("commits the shows shelf last, settling all three sections", () => {
      mockUseDashboard.mockReturnValue(warmCacheData());
      renderDashboard({ advanceStages: false });

      act(() => flushRaf()); // deck
      act(() => flushRaf()); // movies
      act(() => flushRaf()); // shows

      expect(screen.getByText("Breaking Bad")).toBeInTheDocument();
      expect(screen.getByText("Inception")).toBeInTheDocument();
      expect(screen.getByText("Stranger Things")).toBeInTheDocument();
      expect(screen.queryAllByTestId("skeleton-card").length).toBe(0);
    });

    it("emits a per-section commit timing log, tagged dashboard, for each stage", () => {
      mockUseDashboard.mockReturnValue(warmCacheData());
      renderDashboard(); // default: fully advances all stages

      for (const message of [
        "deck shelf committed",
        "movies shelf committed",
        "shows shelf committed",
        "all shelves committed",
      ]) {
        expect(mockLoggerDebug).toHaveBeenCalledWith(
          "dashboard",
          message,
          expect.objectContaining({ ms: expect.any(Number) }),
        );
      }
    });

    it("still emits the pre-existing first-commit timing log", () => {
      mockUseDashboard.mockReturnValue(warmCacheData());
      renderDashboard();

      expect(mockLoggerDebug).toHaveBeenCalledWith("dashboard", "first render start");
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        "dashboard",
        "first commit",
        expect.objectContaining({ ms: expect.any(Number) }),
      );
    });

    // prexu-xb3h: PR #71's per-section stage counter must never regress to
    // a bare full-page spinner at any point in the deck -> movies -> shows
    // sequence — every stage renders either per-section skeleton rows or
    // real content, never a "loading-screen"/centered-spinner takeover of
    // the whole component.
    it("never renders a full-page spinner at any shelf stage, including the very first commit", () => {
      mockUseDashboard.mockReturnValue(warmCacheData());
      const { container } = renderDashboard({ advanceStages: false });

      expect(container.querySelector(".loading-screen")).not.toBeInTheDocument();

      act(() => flushRaf()); // deck
      expect(container.querySelector(".loading-screen")).not.toBeInTheDocument();

      act(() => flushRaf()); // movies
      expect(container.querySelector(".loading-screen")).not.toBeInTheDocument();

      act(() => flushRaf()); // shows
      expect(container.querySelector(".loading-screen")).not.toBeInTheDocument();
    });
  });
});
