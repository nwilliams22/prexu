import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SearchResults from "./SearchResults";

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://plex.test", accessToken: "token" },
  }),
}));

const mockUseSearch = vi.fn();
vi.mock("../hooks/useSearch", () => ({
  useSearch: () => mockUseSearch(),
}));

vi.mock("../services/plex-library", () => ({
  getImageUrl: vi.fn(() => "http://img.test/poster.jpg"),
}));

vi.mock("../utils/media-helpers", () => ({
  getMediaSubtitleShort: vi.fn(() => "2023"),
  isWatched: vi.fn(() => false),
}));

vi.mock("../hooks/useScrollRestoration", () => ({
  useScrollRestoration: vi.fn(),
}));

vi.mock("../components/HorizontalRow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid={`hub-${title}`}>
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
  default: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {subtitle && <span>{subtitle}</span>}
    </div>
  ),
}));

vi.mock("../components/ErrorState", () => ({
  default: ({ message }: { message: string }) => (
    <div data-testid="error-state">{message}</div>
  ),
}));

function renderWithRouter(query = "") {
  return render(
    <MemoryRouter initialEntries={[`/search${query ? `?q=${query}` : ""}`]}>
      <SearchResults />
    </MemoryRouter>
  );
}

describe("SearchResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Search' heading when no query", () => {
    mockUseSearch.mockReturnValue({
      query: "",
      results: [],
      isSearching: false,
      error: null,
    });
    renderWithRouter();
    expect(screen.getByText("Search")).toBeInTheDocument();
  });

  it("renders search results heading with query", () => {
    mockUseSearch.mockReturnValue({
      query: "batman",
      results: [],
      isSearching: false,
      error: null,
    });
    renderWithRouter("batman");
    expect(screen.getByText(/Results for/)).toBeInTheDocument();
  });

  it("shows loading skeletons when searching", () => {
    mockUseSearch.mockReturnValue({
      query: "batman",
      results: [],
      isSearching: true,
      error: null,
    });
    renderWithRouter("batman");
    const skeletons = screen.getAllByTestId("skeleton-card");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows empty state when no results", () => {
    mockUseSearch.mockReturnValue({
      query: "xyznonexistent",
      results: [],
      isSearching: false,
      error: null,
    });
    renderWithRouter("xyznonexistent");
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("renders result hubs with items", () => {
    mockUseSearch.mockReturnValue({
      query: "batman",
      results: [
        {
          hubIdentifier: "movie",
          title: "Movies",
          type: "movie",
          Metadata: [
            { ratingKey: "1", title: "Batman Begins", thumb: "/thumb1" },
            { ratingKey: "2", title: "The Dark Knight", thumb: "/thumb2" },
          ],
        },
      ],
      isSearching: false,
      error: null,
    });
    renderWithRouter("batman");
    expect(screen.getByText("Movies")).toBeInTheDocument();
    expect(screen.getByText("Batman Begins")).toBeInTheDocument();
    expect(screen.getByText("The Dark Knight")).toBeInTheDocument();
  });

  it("shows 'Start typing' when no query", () => {
    mockUseSearch.mockReturnValue({
      query: "",
      results: [],
      isSearching: false,
      error: null,
    });
    renderWithRouter();
    expect(
      screen.getByText("Start typing to search your libraries")
    ).toBeInTheDocument();
  });
});
