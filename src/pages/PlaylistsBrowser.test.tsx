import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import PlaylistsBrowser from "./PlaylistsBrowser";

// Stable mock references to prevent infinite re-renders
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
let mockPlaylists: any[] = [];
let mockIsLoading = false;
let mockError: string | null = null;

vi.mock("../hooks/usePlaylists", () => ({
  usePlaylists: () => ({
    playlists: mockPlaylists,
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

function renderPage() {
  return render(
    <BrowserRouter>
      <PlaylistsBrowser />
    </BrowserRouter>,
  );
}

beforeEach(() => {
  mockPlaylists = [];
  mockIsLoading = false;
  mockError = null;
  vi.clearAllMocks();
});

describe("PlaylistsBrowser", () => {
  it("renders the Playlists heading", () => {
    renderPage();
    expect(screen.getByText("Playlists")).toBeInTheDocument();
  });

  it("shows loading skeletons when loading", () => {
    mockIsLoading = true;
    renderPage();
    // Should render skeleton cards (shimmer divs)
    const skeletons = document.querySelectorAll(".shimmer");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows empty state when no playlists", () => {
    mockPlaylists = [];
    renderPage();
    expect(screen.getByText("No playlists")).toBeInTheDocument();
  });

  it("renders playlist cards with titles", () => {
    mockPlaylists = [
      {
        ratingKey: "1",
        title: "My Playlist",
        composite: "/composite/1",
        thumb: "/thumb/1",
        leafCount: 5,
        type: "playlist",
      },
      {
        ratingKey: "2",
        title: "Another Playlist",
        composite: "",
        thumb: "/thumb/2",
        leafCount: 1,
        type: "playlist",
      },
    ];
    renderPage();
    expect(screen.getByText("My Playlist")).toBeInTheDocument();
    expect(screen.getByText("Another Playlist")).toBeInTheDocument();
  });

  it("shows playlist count", () => {
    mockPlaylists = [
      {
        ratingKey: "1",
        title: "Playlist A",
        composite: "/c/1",
        thumb: "/t/1",
        leafCount: 3,
        type: "playlist",
      },
      {
        ratingKey: "2",
        title: "Playlist B",
        composite: "/c/2",
        thumb: "/t/2",
        leafCount: 7,
        type: "playlist",
      },
    ];
    renderPage();
    expect(screen.getByText("2 playlists")).toBeInTheDocument();
  });

  it("shows singular 'playlist' for single item", () => {
    mockPlaylists = [
      {
        ratingKey: "1",
        title: "Solo",
        composite: "/c/1",
        thumb: "/t/1",
        leafCount: 2,
        type: "playlist",
      },
    ];
    renderPage();
    expect(screen.getByText("1 playlist")).toBeInTheDocument();
  });

  it("shows error state with retry button", () => {
    mockError = "Failed to load playlists";
    renderPage();
    expect(screen.getByText("Failed to load playlists")).toBeInTheDocument();
  });

  it("shows item count subtitle on cards", () => {
    mockPlaylists = [
      {
        ratingKey: "1",
        title: "Test",
        composite: "/c/1",
        thumb: "/t/1",
        leafCount: 10,
        type: "playlist",
      },
    ];
    renderPage();
    expect(screen.getByText("10 items")).toBeInTheDocument();
  });
});
