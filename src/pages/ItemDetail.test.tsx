import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ItemDetail from "./ItemDetail";

const mockUseAuth = vi.fn();
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseParentalControls = vi.fn();
vi.mock("../hooks/useParentalControls", () => ({
  useParentalControls: () => mockUseParentalControls(),
}));

const mockToast = vi.fn();
vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => "desktop",
  isMobile: () => false,
}));

const mockUseItemDetailData = vi.fn();
vi.mock("../hooks/useItemDetailData", () => ({
  useItemDetailData: () => mockUseItemDetailData(),
}));

vi.mock("../hooks/useSeasonSwitch", () => ({
  useSeasonSwitch: () => ({ seasonFading: false, switchSeason: vi.fn() }),
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

vi.mock("../services/plex-library", () => ({
  getImageUrl: vi.fn(() => "http://img.test/poster.jpg"),
  getPlaceholderUrl: vi.fn(() => "http://img.test/placeholder.jpg"),
  getImageSrcSet: vi.fn(() => ""),
  getAllShowEpisodes: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../components/detail/BulkDownloadButton", () => ({
  default: () => <div data-testid="bulk-download-button" />,
}));

vi.mock("../components/HorizontalRow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid={`row-${title}`}>
      <h3>{title}</h3>
      {children}
    </div>
  ),
}));

vi.mock("../components/PosterCard", () => ({
  default: ({ title, onContextMenu }: { title: string; onContextMenu?: (e: React.MouseEvent) => void }) => (
    <div data-testid="poster-card" onContextMenu={onContextMenu}>
      {title}
    </div>
  ),
}));

vi.mock("../components/ErrorState", () => ({
  default: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
    <div data-testid="error-state">
      {message}
      {onRetry && (
        <button onClick={onRetry}>Retry</button>
      )}
    </div>
  ),
}));

vi.mock("../components/detail/DetailSkeleton", () => ({
  default: () => <div data-testid="detail-skeleton" />,
}));

vi.mock("../components/detail/ItemHeroSection", () => ({
  default: ({ item }: { item: { title: string } }) => (
    <div data-testid="hero-section">{item.title}</div>
  ),
}));

vi.mock("../components/detail/EpisodeListSection", () => ({
  default: () => <div data-testid="episode-list-section" />,
}));

vi.mock("../components/detail/CastSection", () => ({
  default: () => <div data-testid="cast-section" />,
}));

vi.mock("../components/detail/AdminActionsBar", () => ({
  default: () => <div data-testid="admin-actions-bar" />,
}));

vi.mock("../components/detail/RatingsSection", () => ({
  default: () => <div data-testid="ratings-section" />,
}));

const mockOpenContextMenu = vi.fn();
vi.mock("../hooks/useMediaContextMenu", () => ({
  useMediaContextMenu: () => ({
    openContextMenu: mockOpenContextMenu,
    overlays: <div data-testid="context-menu-overlays" />,
  }),
}));

const testServer = {
  name: "Test Server",
  clientIdentifier: "srv-id",
  accessToken: "srv-token",
  uri: "https://plex.test:32400",
};

const makeAuth = (overrides: Partial<{ server: typeof testServer | null }> = {}) => ({
  server: testServer,
  activeUser: { id: 1, title: "User", username: "user", thumb: "", isAdmin: true, isHomeUser: false },
  ...overrides,
});

const makeDetailData = (
  overrides: Partial<{
    item: Record<string, unknown> | null;
    isLoading: boolean;
    error: string | null;
    refreshItem: () => void;
    related: Record<string, unknown>[];
    extras: Record<string, unknown>[];
    moreWithActors: { name: string; items: Record<string, unknown>[] }[];
    collectionItems: { collection: Record<string, unknown>; items: Record<string, unknown>[] } | null;
    shelvesLoading: boolean;
    collectionLoading: boolean;
  }> = {}
) => ({
  item: null,
  seasons: [],
  episodes: [],
  isLoading: false,
  error: null,
  parentShow: null,
  siblingSeasons: [],
  siblingEpisodes: [],
  related: [],
  extras: [],
  moreWithActors: [],
  collectionItems: null,
  // Loaded by default so the many existing tests that don't care about the
  // shelf-skeleton reservation (prexu-ct5k) keep seeing the same
  // real-content-or-nothing behavior they asserted before it was added.
  shelvesLoading: false,
  collectionLoading: false,
  showFixMatch: false,
  setShowFixMatch: vi.fn(),
  refreshItem: vi.fn(),
  setItem: vi.fn(),
  setIsLoading: vi.fn(),
  setEpisodes: vi.fn(),
  ...overrides,
});

const movieItem = {
  ratingKey: "100",
  title: "Inception",
  type: "movie",
  year: 2010,
  thumb: "/thumb",
  art: "/art",
};

function renderItemDetail() {
  return render(
    <MemoryRouter>
      <ItemDetail />
    </MemoryRouter>
  );
}

describe("ItemDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(makeAuth());
    mockUseParentalControls.mockReturnValue({
      restrictionsEnabled: false,
      isItemAllowed: () => true,
    });
    mockUseItemDetailData.mockReturnValue(makeDetailData());
  });

  it("renders movie detail when item is loaded", () => {
    mockUseItemDetailData.mockReturnValue(makeDetailData({ item: movieItem }));
    renderItemDetail();
    expect(screen.getByTestId("hero-section")).toHaveTextContent("Inception");
  });

  it("renders nothing when no server is selected", () => {
    mockUseAuth.mockReturnValue(makeAuth({ server: null }));
    const { container } = renderItemDetail();
    expect(container).toBeEmptyDOMElement();
  });

  it("does not throw when server transitions from null to non-null", () => {
    mockUseAuth.mockReturnValue(makeAuth({ server: null }));
    mockUseItemDetailData.mockReturnValue(makeDetailData({ item: movieItem }));

    const { rerender } = renderItemDetail();

    mockUseAuth.mockReturnValue(makeAuth());
    expect(() =>
      rerender(
        <MemoryRouter>
          <ItemDetail />
        </MemoryRouter>
      )
    ).not.toThrow();
    expect(screen.getByTestId("hero-section")).toHaveTextContent("Inception");
  });

  it("renders a detail-shaped skeleton instead of a bare spinner while loading", () => {
    mockUseItemDetailData.mockReturnValue(makeDetailData({ isLoading: true }));
    renderItemDetail();
    expect(screen.getByTestId("detail-skeleton")).toBeInTheDocument();
  });

  it("wires refreshItem as the error state's retry handler", () => {
    const refreshItem = vi.fn();
    mockUseItemDetailData.mockReturnValue(
      makeDetailData({ error: "Network error", refreshItem })
    );
    renderItemDetail();

    screen.getByRole("button", { name: "Retry" }).click();
    expect(refreshItem).toHaveBeenCalledTimes(1);
  });

  it("toasts and redirects restricted content even while server is null", () => {
    mockUseAuth.mockReturnValue(makeAuth({ server: null }));
    mockUseParentalControls.mockReturnValue({
      restrictionsEnabled: true,
      isItemAllowed: () => false,
    });
    mockUseItemDetailData.mockReturnValue(
      makeDetailData({ item: { ...movieItem, contentRating: "R" } })
    );

    renderItemDetail();

    expect(mockToast).toHaveBeenCalledWith(
      "This content is restricted on your profile",
      "error"
    );
  });

  it("wires context menu to season poster cards on show detail", () => {
    const showItem = {
      ratingKey: "200",
      title: "Breaking Bad",
      type: "show",
      year: 2008,
      thumb: "/thumb",
      art: "/art",
    };
    const season = {
      ratingKey: "201",
      title: "Season 1",
      type: "season",
      leafCount: 7,
      viewedLeafCount: 0,
      thumb: "/thumb",
    };
    mockUseItemDetailData.mockReturnValue(
      makeDetailData({ item: showItem, seasons: [season] })
    );
    renderItemDetail();

    const posterCards = screen.getAllByTestId("poster-card");
    expect(posterCards.length).toBeGreaterThan(0);

    // Simulate right-click on season card
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    posterCards[0].dispatchEvent(event);

    expect(mockOpenContextMenu).toHaveBeenCalled();
    const callArgs = mockOpenContextMenu.mock.calls[0];
    expect(callArgs[1]).toEqual(expect.objectContaining({
      ratingKey: season.ratingKey,
    }));
  });

  it("renders context menu overlays on show detail page", () => {
    const showItem = {
      ratingKey: "200",
      title: "Breaking Bad",
      type: "show",
      year: 2008,
      thumb: "/thumb",
      art: "/art",
    };
    mockUseItemDetailData.mockReturnValue(
      makeDetailData({ item: showItem })
    );
    renderItemDetail();

    expect(screen.getByTestId("context-menu-overlays")).toBeInTheDocument();
  });

  // prexu-ct5k: a warm-cache entry paints core content (hero/cast) instantly,
  // but the related/extras/actors/collection shelves land later. Without
  // reserved space, ItemDetail renders nothing for those shelves until they
  // arrive, and their arrival pushes the already-painted page around — the
  // "entry flash" this issue fixes.
  describe("shelf-skeleton reservation while shelves are loading (prexu-ct5k)", () => {
    it("renders shelf skeletons alongside already-painted core content in the same commit", () => {
      mockUseItemDetailData.mockReturnValue(
        makeDetailData({ item: movieItem, shelvesLoading: true, collectionLoading: true })
      );
      renderItemDetail();

      // Core content is already painted...
      expect(screen.getByTestId("hero-section")).toHaveTextContent("Inception");
      expect(screen.getByTestId("cast-section")).toBeInTheDocument();
      // ...and every shelf that would otherwise pop in later has reserved,
      // same-height placeholder space instead of rendering nothing.
      expect(screen.getByTestId("shelf-skeleton-extras")).toBeInTheDocument();
      expect(screen.getByTestId("shelf-skeleton-collection")).toBeInTheDocument();
      expect(screen.getByTestId("shelf-skeleton-related")).toBeInTheDocument();
      expect(screen.getByTestId("shelf-skeleton-actors")).toBeInTheDocument();
      // No real shelf content has rendered yet.
      expect(screen.queryByTestId("row-Extras")).not.toBeInTheDocument();
      expect(screen.queryByTestId("row-Related")).not.toBeInTheDocument();
    });

    it("replaces shelf skeletons with real content once shelves arrive, without disturbing core content", () => {
      mockUseItemDetailData.mockReturnValue(
        makeDetailData({ item: movieItem, shelvesLoading: true, collectionLoading: true })
      );
      const { rerender } = renderItemDetail();

      expect(screen.getByTestId("shelf-skeleton-related")).toBeInTheDocument();

      const related = [{ ratingKey: "300", title: "Related Movie", thumb: "/thumb" }];
      const extras = [{ ratingKey: "301", title: "Trailer", thumb: "/thumb" }];
      mockUseItemDetailData.mockReturnValue(
        makeDetailData({
          item: movieItem,
          shelvesLoading: false,
          collectionLoading: false,
          related,
          extras,
        })
      );
      rerender(
        <MemoryRouter>
          <ItemDetail />
        </MemoryRouter>
      );

      // Skeletons are gone, replaced by the real rows.
      expect(screen.queryByTestId("shelf-skeleton-extras")).not.toBeInTheDocument();
      expect(screen.queryByTestId("shelf-skeleton-related")).not.toBeInTheDocument();
      expect(screen.getByTestId("row-Extras")).toBeInTheDocument();
      expect(screen.getByTestId("row-Related")).toBeInTheDocument();
      // Core content (hero/cast) never changed identity or content.
      expect(screen.getByTestId("hero-section")).toHaveTextContent("Inception");
      expect(screen.getByTestId("cast-section")).toBeInTheDocument();
    });

    it("renders no shelf content (skeleton or real) once shelves resolve to empty, matching prior no-shelf behavior", () => {
      mockUseItemDetailData.mockReturnValue(
        makeDetailData({ item: movieItem, shelvesLoading: false, collectionLoading: false })
      );
      renderItemDetail();

      expect(screen.queryByTestId("shelf-skeleton-extras")).not.toBeInTheDocument();
      expect(screen.queryByTestId("shelf-skeleton-related")).not.toBeInTheDocument();
      expect(screen.queryByTestId("row-Extras")).not.toBeInTheDocument();
      expect(screen.queryByTestId("row-Related")).not.toBeInTheDocument();
    });
  });
});
