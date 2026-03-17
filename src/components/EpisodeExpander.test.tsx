import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EpisodeExpander from "./EpisodeExpander";
import {
  createGroupedRecentItem,
  createPlexEpisode,
  createPlexSeason,
} from "../__tests__/mocks/plex-data";

const mockGetImageUrl = vi.fn();
const mockGetItemChildren = vi.fn();

vi.mock("../services/plex-library", () => ({
  getImageUrl: (...args: unknown[]) => mockGetImageUrl(...args),
  getItemChildren: (...args: unknown[]) => mockGetItemChildren(...args),
}));

const defaultProps = {
  group: createGroupedRecentItem({
    kind: "show" as const,
    title: "Breaking Bad",
    groupKey: "show-100",
    episodes: [
      createPlexEpisode({
        ratingKey: "ep1",
        title: "Pilot",
        index: 1,
        parentIndex: 1,
        duration: 3480000,
        originallyAvailableAt: "2008-01-20",
      }),
      createPlexEpisode({
        ratingKey: "ep2",
        title: "Cat's in the Bag...",
        index: 2,
        parentIndex: 1,
        duration: 2880000,
        originallyAvailableAt: "2008-01-27",
      }),
    ],
    episodeCount: 2,
  }),
  serverUri: "https://192.168.1.100:32400",
  serverToken: "test-token",
  onClose: vi.fn(),
  onPlayEpisode: vi.fn(),
  onViewShow: vi.fn(),
  onViewEpisode: vi.fn(),
};

describe("EpisodeExpander", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImageUrl.mockReturnValue("https://example.com/thumb.jpg");
    mockGetItemChildren.mockResolvedValue([]);
  });

  it("renders the show title", () => {
    render(<EpisodeExpander {...defaultProps} />);
    expect(screen.getByText("Breaking Bad")).toBeInTheDocument();
  });

  it("renders episode titles", () => {
    render(<EpisodeExpander {...defaultProps} />);
    expect(screen.getByText("Pilot")).toBeInTheDocument();
    expect(screen.getByText("Cat's in the Bag...")).toBeInTheDocument();
  });

  it("renders episode numbers formatted as S01E01", () => {
    render(<EpisodeExpander {...defaultProps} />);
    expect(screen.getByText("S01E01")).toBeInTheDocument();
    expect(screen.getByText("S01E02")).toBeInTheDocument();
  });

  it("renders episode air dates", () => {
    render(<EpisodeExpander {...defaultProps} />);
    expect(screen.getByText("2008-01-20")).toBeInTheDocument();
    expect(screen.getByText("2008-01-27")).toBeInTheDocument();
  });

  it("renders formatted episode durations", () => {
    render(<EpisodeExpander {...defaultProps} />);
    expect(screen.getByText("58m")).toBeInTheDocument(); // 3480000ms
    expect(screen.getByText("48m")).toBeInTheDocument(); // 2880000ms
  });

  it("has a View Show button", () => {
    render(<EpisodeExpander {...defaultProps} />);
    expect(screen.getByText("View Show")).toBeInTheDocument();
  });

  it("calls onViewShow when View Show is clicked", async () => {
    const user = userEvent.setup();
    render(<EpisodeExpander {...defaultProps} />);

    await user.click(screen.getByText("View Show"));
    expect(defaultProps.onViewShow).toHaveBeenCalledWith("show-100");
  });

  it("has a close button", () => {
    render(<EpisodeExpander {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Close episode list" })).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    render(<EpisodeExpander {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Close episode list" }));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("closes on Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EpisodeExpander {...defaultProps} onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onPlayEpisode when play button is clicked", async () => {
    const user = userEvent.setup();
    render(<EpisodeExpander {...defaultProps} />);

    const playButtons = screen.getAllByRole("button", { name: /Play/ });
    await user.click(playButtons[0]);
    expect(defaultProps.onPlayEpisode).toHaveBeenCalledWith("ep1");
  });

  it("calls onViewEpisode when episode row is clicked", async () => {
    const user = userEvent.setup();
    render(<EpisodeExpander {...defaultProps} />);

    // Click on the episode info area (not the play button)
    await user.click(screen.getByText("Pilot"));
    expect(defaultProps.onViewEpisode).toHaveBeenCalledWith("ep1");
  });

  it("sorts episodes by season then episode number", () => {
    const group = createGroupedRecentItem({
      kind: "show" as const,
      title: "Test Show",
      groupKey: "show-200",
      episodes: [
        createPlexEpisode({ ratingKey: "e3", title: "Ep S2E1", index: 1, parentIndex: 2 }),
        createPlexEpisode({ ratingKey: "e1", title: "Ep S1E1", index: 1, parentIndex: 1 }),
        createPlexEpisode({ ratingKey: "e2", title: "Ep S1E2", index: 2, parentIndex: 1 }),
      ],
      episodeCount: 3,
    });
    render(<EpisodeExpander {...defaultProps} group={group} />);

    const episodeNumbers = screen.getAllByText(/S\d{2}E\d{2}/);
    expect(episodeNumbers[0].textContent).toBe("S01E01");
    expect(episodeNumbers[1].textContent).toBe("S01E02");
    expect(episodeNumbers[2].textContent).toBe("S02E01");
  });

  it("fetches seasons and episodes when group.episodes is empty", async () => {
    const seasons = [
      createPlexSeason({ ratingKey: "s1", index: 1, title: "Season 1" }),
    ];
    const episodes = [
      createPlexEpisode({ ratingKey: "fetched-ep", title: "Fetched Episode", index: 1, parentIndex: 1 }),
    ];
    mockGetItemChildren
      .mockResolvedValueOnce(seasons) // fetch seasons
      .mockResolvedValueOnce(episodes); // fetch episodes from season

    const group = createGroupedRecentItem({
      kind: "show" as const,
      title: "Show With No Episodes",
      groupKey: "show-300",
      episodes: [],
      episodeCount: 0,
      seasonIndices: [],
    });

    render(
      <EpisodeExpander
        {...defaultProps}
        group={group}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Fetched Episode")).toBeInTheDocument();
    });
  });

  it("applies closing style when closing prop is true", () => {
    const { container } = render(
      <EpisodeExpander {...defaultProps} closing={true} />
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.opacity).toBe("0");
  });

  it("renders episode thumbnail images", () => {
    render(<EpisodeExpander {...defaultProps} />);
    const images = screen.getAllByRole("img");
    expect(images.length).toBe(2);
    expect(images[0]).toHaveAttribute("alt", "Pilot");
    expect(images[1]).toHaveAttribute("alt", "Cat's in the Bag...");
  });

  it("formats hour-long durations with hours", () => {
    const group = createGroupedRecentItem({
      kind: "show" as const,
      title: "Long Show",
      groupKey: "show-400",
      episodes: [
        createPlexEpisode({
          ratingKey: "long-ep",
          title: "Long Episode",
          index: 1,
          parentIndex: 1,
          duration: 5400000, // 90 minutes = 1h 30m
        }),
      ],
      episodeCount: 1,
    });
    render(<EpisodeExpander {...defaultProps} group={group} />);
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
  });
});
