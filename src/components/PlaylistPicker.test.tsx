import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PlaylistPicker from "./PlaylistPicker";
import { createPlexPlaylist } from "../__tests__/mocks/plex-data";

vi.mock("../hooks/useFocusTrap", () => ({
  useFocusTrap: vi.fn(),
}));

const mockGetPlaylists = vi.fn();
const mockAddToPlaylist = vi.fn();
const mockCreatePlaylist = vi.fn();

vi.mock("../services/plex-library", () => ({
  getPlaylists: (...args: unknown[]) => mockGetPlaylists(...args),
  addToPlaylist: (...args: unknown[]) => mockAddToPlaylist(...args),
  createPlaylist: (...args: unknown[]) => mockCreatePlaylist(...args),
}));

vi.mock("../services/api-cache", () => ({
  cacheInvalidate: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: vi.fn(() => ({
    server: {
      uri: "https://192.168.1.100:32400",
      accessToken: "test-token",
      clientIdentifier: "test-id",
    },
  })),
}));

const defaultProps = {
  ratingKey: "456",
  title: "Test Movie",
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe("PlaylistPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlaylists.mockResolvedValue([]);
  });

  it("renders the dialog with heading", async () => {
    render(<PlaylistPicker {...defaultProps} />);
    expect(screen.getByText("Add to Playlist")).toBeInTheDocument();
  });

  it("shows the item title", () => {
    render(<PlaylistPicker {...defaultProps} />);
    expect(screen.getByText("Test Movie")).toBeInTheDocument();
  });

  it("has accessible dialog role", () => {
    render(<PlaylistPicker {...defaultProps} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("shows loading state while fetching playlists", () => {
    mockGetPlaylists.mockReturnValue(new Promise(() => {})); // never resolves
    render(<PlaylistPicker {...defaultProps} />);
    expect(screen.getByText("Loading playlists...")).toBeInTheDocument();
  });

  it("shows empty state when no playlists exist", async () => {
    mockGetPlaylists.mockResolvedValue([]);
    render(<PlaylistPicker {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("No playlists yet")).toBeInTheDocument();
    });
  });

  it("renders playlist items after loading", async () => {
    const playlists = [
      createPlexPlaylist({ title: "My Favorites", leafCount: 5 }),
      createPlexPlaylist({ title: "Watch Later", leafCount: 12 }),
    ];
    mockGetPlaylists.mockResolvedValue(playlists);
    render(<PlaylistPicker {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("My Favorites")).toBeInTheDocument();
      expect(screen.getByText("Watch Later")).toBeInTheDocument();
    });
    expect(screen.getByText("5 items")).toBeInTheDocument();
    expect(screen.getByText("12 items")).toBeInTheDocument();
  });

  it("shows singular 'item' for single-item playlist", async () => {
    const playlists = [
      createPlexPlaylist({ title: "Solo", leafCount: 1 }),
    ];
    mockGetPlaylists.mockResolvedValue(playlists);
    render(<PlaylistPicker {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("1 item")).toBeInTheDocument();
    });
  });

  it("calls addToPlaylist when clicking a playlist", async () => {
    const user = userEvent.setup();
    const playlists = [
      createPlexPlaylist({ ratingKey: "pl1", title: "My Favorites", leafCount: 3 }),
    ];
    mockGetPlaylists.mockResolvedValue(playlists);
    mockAddToPlaylist.mockResolvedValue(undefined);
    render(<PlaylistPicker {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("My Favorites")).toBeInTheDocument();
    });

    await user.click(screen.getByText("My Favorites"));

    await waitFor(() => {
      expect(mockAddToPlaylist).toHaveBeenCalledWith(
        "https://192.168.1.100:32400",
        "test-token",
        "pl1",
        "456",
        "test-id"
      );
    });
  });

  it("shows success banner after adding to playlist", async () => {
    const user = userEvent.setup();
    const playlists = [
      createPlexPlaylist({ ratingKey: "pl1", title: "My Favorites", leafCount: 3 }),
    ];
    mockGetPlaylists.mockResolvedValue(playlists);
    mockAddToPlaylist.mockResolvedValue(undefined);
    render(<PlaylistPicker {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("My Favorites")).toBeInTheDocument();
    });

    await user.click(screen.getByText("My Favorites"));

    await waitFor(() => {
      expect(screen.getByText(/Added to "My Favorites"/)).toBeInTheDocument();
    });
  });

  it("calls onSuccess after adding to playlist", async () => {
    const user = userEvent.setup();
    const playlists = [
      createPlexPlaylist({ ratingKey: "pl1", title: "My Fav", leafCount: 2 }),
    ];
    mockGetPlaylists.mockResolvedValue(playlists);
    mockAddToPlaylist.mockResolvedValue(undefined);
    render(<PlaylistPicker {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("My Fav")).toBeInTheDocument();
    });

    await user.click(screen.getByText("My Fav"));

    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalled();
    });
  });

  it("shows error when addToPlaylist fails", async () => {
    const user = userEvent.setup();
    const playlists = [
      createPlexPlaylist({ ratingKey: "pl1", title: "My Fav", leafCount: 2 }),
    ];
    mockGetPlaylists.mockResolvedValue(playlists);
    mockAddToPlaylist.mockRejectedValue(new Error("Network error"));
    render(<PlaylistPicker {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("My Fav")).toBeInTheDocument();
    });

    await user.click(screen.getByText("My Fav"));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("has a close button that calls onClose", async () => {
    const user = userEvent.setup();
    render(<PlaylistPicker {...defaultProps} />);

    const closeBtn = screen.getByRole("button", { name: "Close" });
    await user.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("closes on Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PlaylistPicker {...defaultProps} onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on overlay click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PlaylistPicker {...defaultProps} onClose={onClose} />);

    // The overlay is the parent of the dialog
    const dialog = screen.getByRole("dialog");
    const overlay = dialog.parentElement!;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("has a create new playlist input", () => {
    render(<PlaylistPicker {...defaultProps} />);
    expect(screen.getByPlaceholderText("New playlist name...")).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
  });

  it("calls createPlaylist with new name", async () => {
    const user = userEvent.setup();
    mockGetPlaylists.mockResolvedValue([]);
    mockCreatePlaylist.mockResolvedValue(undefined);
    render(<PlaylistPicker {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("No playlists yet")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("New playlist name...");
    await user.type(input, "My New Playlist");
    await user.click(screen.getByText("Create"));

    await waitFor(() => {
      expect(mockCreatePlaylist).toHaveBeenCalledWith(
        "https://192.168.1.100:32400",
        "test-token",
        "My New Playlist",
        "456",
        "test-id"
      );
    });
  });

  it("shows error when playlist fetching fails", async () => {
    mockGetPlaylists.mockRejectedValue(new Error("Server unavailable"));
    render(<PlaylistPicker {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Server unavailable")).toBeInTheDocument();
    });
  });
});
