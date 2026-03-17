import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContentRequestForm from "./ContentRequestForm";

// Mock all external dependencies
vi.mock("../hooks/useFocusTrap", () => ({
  useFocusTrap: vi.fn(),
}));

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop"),
  isMobile: vi.fn(() => false),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: vi.fn(() => ({
    authToken: "test-token",
  })),
}));

const mockSubmitRequest = vi.fn();
vi.mock("../hooks/useContentRequests", () => ({
  useContentRequests: vi.fn(() => ({
    submitRequest: mockSubmitRequest,
  })),
}));

const mockIsTmdbAvailable = vi.fn();
const mockSearchTmdbMovies = vi.fn();
const mockSearchTmdbTvShows = vi.fn();
const mockFindByImdbId = vi.fn();
const mockGetTmdbImageUrl = vi.fn();
const mockIsValidImdbId = vi.fn();

vi.mock("../services/tmdb", () => ({
  searchTmdbMovies: (...args: unknown[]) => mockSearchTmdbMovies(...args),
  searchTmdbTvShows: (...args: unknown[]) => mockSearchTmdbTvShows(...args),
  findByImdbId: (...args: unknown[]) => mockFindByImdbId(...args),
  getTmdbImageUrl: (...args: unknown[]) => mockGetTmdbImageUrl(...args),
  isValidImdbId: (...args: unknown[]) => mockIsValidImdbId(...args),
  isTmdbAvailable: (...args: unknown[]) => mockIsTmdbAvailable(...args),
}));

vi.mock("../services/plex-api", () => ({
  discoverServers: vi.fn(() => Promise.resolve([])),
}));

const defaultProps = {
  onClose: vi.fn(),
};

describe("ContentRequestForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTmdbAvailable.mockResolvedValue(true);
    mockGetTmdbImageUrl.mockReturnValue(null);
    mockIsValidImdbId.mockReturnValue(false);
    mockSearchTmdbMovies.mockResolvedValue({ results: [] });
    mockSearchTmdbTvShows.mockResolvedValue({ results: [] });
  });

  it("shows loading state initially", () => {
    render(<ContentRequestForm {...defaultProps} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows unavailable message when TMDb proxy is not available", async () => {
    mockIsTmdbAvailable.mockResolvedValue(false);
    render(<ContentRequestForm {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("TMDb Search Unavailable")).toBeInTheDocument();
    });
  });

  it("shows main search form when TMDb proxy is available", async () => {
    render(<ContentRequestForm {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Request Content")).toBeInTheDocument();
    });
  });

  it("shows Search and IMDb ID mode tabs", async () => {
    render(<ContentRequestForm {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Search")).toBeInTheDocument();
      expect(screen.getByText("IMDb ID")).toBeInTheDocument();
    });
  });

  it("shows Movies and TV Shows sub-tabs in search mode", async () => {
    render(<ContentRequestForm {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Movies")).toBeInTheDocument();
      expect(screen.getByText("TV Shows")).toBeInTheDocument();
    });
  });

  it("has a Cancel button that calls onClose", async () => {
    const user = userEvent.setup();
    render(<ContentRequestForm {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Cancel"));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ContentRequestForm onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText("Request Content")).toBeInTheDocument();
    });

    // Click the backdrop (the outer div)
    const backdrop = screen.getByText("Request Content").closest("[role='dialog']")!.parentElement!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ContentRequestForm onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText("Request Content")).toBeInTheDocument();
    });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("switches to IMDb ID mode when clicking IMDb tab", async () => {
    const user = userEvent.setup();
    render(<ContentRequestForm {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("IMDb ID")).toBeInTheDocument();
    });

    await user.click(screen.getByText("IMDb ID"));
    expect(screen.getByPlaceholderText("tt1234567")).toBeInTheDocument();
    expect(screen.getByText("Look up")).toBeInTheDocument();
  });

  it("uses initialQuery prop for search input", async () => {
    render(<ContentRequestForm {...defaultProps} initialQuery="Inception" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Inception")).toBeInTheDocument();
    });
  });

  it("uses initialMediaType prop to set initial tab", async () => {
    render(<ContentRequestForm {...defaultProps} initialMediaType="tv" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search TV shows...")).toBeInTheDocument();
    });
  });

  it("shows Close button on unavailable screen", async () => {
    mockIsTmdbAvailable.mockResolvedValue(false);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ContentRequestForm onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText("Close")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders dialog with proper aria attributes", async () => {
    render(<ContentRequestForm {...defaultProps} />);

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });
  });
});
