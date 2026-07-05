import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PlaylistDetail from "./PlaylistDetail";

const mockUseParams = vi.fn(() => ({ playlistKey: "300" }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => mockUseParams(),
    useNavigate: () => vi.fn(),
  };
});

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://plex.test", accessToken: "token" },
  }),
}));

const mockUseDetailItems = vi.fn();
vi.mock("../hooks/useDetailItems", () => ({
  useDetailItems: (...args: unknown[]) => mockUseDetailItems(...args),
}));

vi.mock("../services/plex-library", () => ({
  getImageUrl: vi.fn(() => "http://img.test/poster.jpg"),
  getPlaylistItems: vi.fn(),
  getPlaylists: vi.fn(),
  deletePlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  movePlaylistItem: vi.fn(),
  updatePlaylist: vi.fn(),
}));

vi.mock("../services/api-cache", () => ({
  cacheInvalidate: vi.fn(),
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

vi.mock("../hooks/usePlayAll", () => ({
  usePlayAll: () => ({
    hasPlayableItems: false,
    playAll: vi.fn(),
    shuffle: vi.fn(),
  }),
}));

vi.mock("../hooks/useScrollRestoration", () => ({
  useScrollRestoration: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PlaylistDetail />
    </MemoryRouter>,
  );
}

function makeItem(ratingKey: string, title: string) {
  return {
    ratingKey,
    title,
    type: "movie",
    thumb: `/t/${ratingKey}`,
    summary: "",
    art: "",
    addedAt: 0,
    updatedAt: 0,
    playlistItemID: Number(ratingKey),
  };
}

describe("PlaylistDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders playlist items via the virtualized grid (ungrouped path)", () => {
    mockUseDetailItems.mockReturnValue({
      metadata: { ratingKey: "300", title: "My Favorites", summary: "" },
      items: [makeItem("1", "Movie One"), makeItem("2", "Movie Two")],
      totalSize: 2,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("My Favorites")).toBeInTheDocument();
    expect(screen.getByText("Movie One")).toBeInTheDocument();
    expect(screen.getByText("Movie Two")).toBeInTheDocument();
  });

  it("shows the empty state when the playlist has no items", () => {
    mockUseDetailItems.mockReturnValue({
      metadata: { ratingKey: "300", title: "Empty List", summary: "" },
      items: [],
      totalSize: 0,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Empty playlist")).toBeInTheDocument();
  });

  it("shows the error state when loading the playlist fails", () => {
    mockUseDetailItems.mockReturnValue({
      metadata: null,
      items: [],
      totalSize: 0,
      isLoading: false,
      error: "Failed to load playlist",
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Failed to load playlist")).toBeInTheDocument();
  });
});
