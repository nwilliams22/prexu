import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShowExpansionPanel from "./ShowExpansionPanel";

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://plex.test", accessToken: "token" },
  }),
}));

const mockShow = {
  title: "Breaking Bad",
  year: 2008,
  contentRating: "TV-MA",
  rating: 9.5,
  childCount: 5,
  leafCount: 62,
  viewedLeafCount: 30,
  thumb: "/thumb",
  summary: "A chemistry teacher...",
  Genre: [{ tag: "Drama" }, { tag: "Crime" }],
};

const mockSeasons = [
  { ratingKey: "s1", title: "Season 1" },
  { ratingKey: "s2", title: "Season 2" },
];

vi.mock("../services/plex-library", () => ({
  getItemMetadata: vi.fn(() => Promise.resolve(mockShow)),
  getItemChildren: vi.fn(() => Promise.resolve(mockSeasons)),
  getImageUrl: vi.fn(() => "http://img.test/poster.jpg"),
}));

const defaultProps = {
  ratingKey: "100",
  onClose: vi.fn(),
  onNavigateToShow: vi.fn(),
  onNavigateToSeason: vi.fn(),
};

describe("ShowExpansionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    render(<ShowExpansionPanel {...defaultProps} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders show title after loading", async () => {
    render(<ShowExpansionPanel {...defaultProps} />);
    expect(await screen.findByText("Breaking Bad")).toBeInTheDocument();
  });

  it("renders close button with aria-label", async () => {
    render(<ShowExpansionPanel {...defaultProps} />);
    await screen.findByText("Breaking Bad");
    expect(screen.getByLabelText("Collapse details")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    render(<ShowExpansionPanel {...defaultProps} />);

    await screen.findByText("Breaking Bad");
    await user.click(screen.getByLabelText("Collapse details"));

    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it("calls onNavigateToShow when 'View Show' is clicked", async () => {
    const user = userEvent.setup();
    render(<ShowExpansionPanel {...defaultProps} />);

    const viewShowButton = await screen.findByText("View Show");
    await user.click(viewShowButton);

    expect(defaultProps.onNavigateToShow).toHaveBeenCalledWith("100");
  });

  it("renders season buttons and calls onNavigateToSeason", async () => {
    const user = userEvent.setup();
    render(<ShowExpansionPanel {...defaultProps} />);

    const season1Button = await screen.findByText("Season 1");
    const season2Button = screen.getByText("Season 2");
    expect(season1Button).toBeInTheDocument();
    expect(season2Button).toBeInTheDocument();

    await user.click(season1Button);
    expect(defaultProps.onNavigateToSeason).toHaveBeenCalledWith("s1");

    await user.click(season2Button);
    expect(defaultProps.onNavigateToSeason).toHaveBeenCalledWith("s2");
  });
});
