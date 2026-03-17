import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import CollectionsBrowser from "./CollectionsBrowser";

// Stable mock references
const stableServer = {
  name: "Test Server",
  uri: "http://localhost:32400",
  accessToken: "test-token",
  machineIdentifier: "machine-123",
};

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    server: stableServer,
    authToken: "test-token",
    isAuthenticated: true,
  }),
}));

const mockRetry = vi.fn();
let mockCollections: any[] = [];
let mockIsLoading = false;
let mockError: string | null = null;

vi.mock("../hooks/useCollections", () => ({
  useCollections: () => ({
    collections: mockCollections,
    isLoading: mockIsLoading,
    error: mockError,
    retry: mockRetry,
  }),
}));

vi.mock("../services/plex-library", () => ({
  getImageUrl: (uri: string, _token: string, thumb: string) =>
    `${uri}${thumb}`,
}));

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => "desktop",
  isDesktopOrAbove: () => true,
  isTabletOrBelow: () => false,
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

vi.mock("../hooks/useScrollRestoration", () => ({
  useScrollRestoration: vi.fn(),
}));

function renderPage() {
  return render(
    <BrowserRouter>
      <CollectionsBrowser />
    </BrowserRouter>,
  );
}

beforeEach(() => {
  mockCollections = [];
  mockIsLoading = false;
  mockError = null;
  vi.clearAllMocks();
});

describe("CollectionsBrowser", () => {
  it("renders the Collections heading", () => {
    renderPage();
    expect(screen.getByText("Collections")).toBeInTheDocument();
  });

  it("shows loading skeletons when loading", () => {
    mockIsLoading = true;
    renderPage();
    const skeletons = document.querySelectorAll(".shimmer");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows empty state when no collections", () => {
    mockCollections = [];
    renderPage();
    expect(screen.getByText("No collections")).toBeInTheDocument();
  });

  it("shows error state", () => {
    mockError = "Network error";
    renderPage();
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("renders collection cards", () => {
    mockCollections = [
      {
        section: { key: "1", title: "Movies", type: "movie", agent: "", scanner: "", thumb: "", art: "", updatedAt: 0 },
        items: [
          {
            ratingKey: "10",
            title: "Marvel Collection",
            thumb: "/thumb/10",
            childCount: 20,
          },
          {
            ratingKey: "11",
            title: "DC Collection",
            thumb: "/thumb/11",
            childCount: 8,
          },
        ],
      },
    ];
    renderPage();
    expect(screen.getByText("Marvel Collection")).toBeInTheDocument();
    expect(screen.getByText("DC Collection")).toBeInTheDocument();
  });

  it("shows search input when collections exist", () => {
    mockCollections = [
      {
        section: { key: "1", title: "Movies", type: "movie", agent: "", scanner: "", thumb: "", art: "", updatedAt: 0 },
        items: [
          { ratingKey: "10", title: "Test", thumb: "/t/10", childCount: 5 },
        ],
      },
    ];
    renderPage();
    expect(
      screen.getByPlaceholderText("Search collections..."),
    ).toBeInTheDocument();
  });

  it("filters collections by search query", async () => {
    const user = userEvent.setup();
    mockCollections = [
      {
        section: { key: "1", title: "Movies", type: "movie", agent: "", scanner: "", thumb: "", art: "", updatedAt: 0 },
        items: [
          { ratingKey: "10", title: "Marvel", thumb: "/t/10", childCount: 20 },
          { ratingKey: "11", title: "DC", thumb: "/t/11", childCount: 8 },
          { ratingKey: "12", title: "Horror", thumb: "/t/12", childCount: 15 },
        ],
      },
    ];
    renderPage();

    const searchInput = screen.getByPlaceholderText("Search collections...");
    await user.type(searchInput, "Marvel");

    expect(screen.getByText("Marvel")).toBeInTheDocument();
    expect(screen.queryByText("DC")).not.toBeInTheDocument();
    expect(screen.queryByText("Horror")).not.toBeInTheDocument();
  });

  it("shows total count of filtered collections", () => {
    mockCollections = [
      {
        section: { key: "1", title: "Movies", type: "movie", agent: "", scanner: "", thumb: "", art: "", updatedAt: 0 },
        items: [
          { ratingKey: "10", title: "A", thumb: "/t/10", childCount: 4 },
          { ratingKey: "11", title: "B", thumb: "/t/11", childCount: 2 },
          { ratingKey: "12", title: "C", thumb: "/t/12", childCount: 3 },
        ],
      },
    ];
    renderPage();
    expect(screen.getByText(/3 collections/)).toBeInTheDocument();
  });
});
