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
  default: ({ title }: { title: string }) => (
    <div data-testid="poster-card">{title}</div>
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
});
