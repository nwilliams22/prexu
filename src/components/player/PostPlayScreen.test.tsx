import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import PostPlayScreen from "./PostPlayScreen";
import type { QueueItem } from "../../types/queue";

const episodeItem: QueueItem = {
  ratingKey: "ep-2",
  title: "Felina",
  subtitle: "S05E16 · Felina",
  thumb: "/library/metadata/2/thumb",
  duration: 3300000, // 55 min
  type: "episode",
};

const movieItem: QueueItem = {
  ratingKey: "mv-7",
  title: "Inception",
  subtitle: "2010",
  thumb: "/library/metadata/7/thumb",
  duration: 8880000, // 148 min
  type: "movie",
};

const baseProps = {
  onPlayNext: vi.fn(),
  onStop: vi.fn(),
  posterUrl: (path: string) => `https://plex.example/img${path}`,
  autoPlayEnabled: true,
  onAutoPlayChange: vi.fn(),
};

describe("PostPlayScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders dialog role with accessible label", () => {
    render(<PostPlayScreen {...baseProps} nextItem={episodeItem} />);
    expect(screen.getByRole("dialog", { name: /playing next/i })).toBeInTheDocument();
  });

  it("shows S/E badge parsed from subtitle for episodes", () => {
    render(<PostPlayScreen {...baseProps} nextItem={episodeItem} />);
    // "S05E16" → "S5 E16"
    expect(screen.getByText("S5 E16")).toBeInTheDocument();
  });

  it("prefers explicit seasonEpisodeBadge prop over parsed value", () => {
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        seasonEpisodeBadge="S2 E5"
      />,
    );
    expect(screen.getByText("S2 E5")).toBeInTheDocument();
    expect(screen.queryByText("S5 E16")).not.toBeInTheDocument();
  });

  it("does not render S/E badge for non-episode items", () => {
    render(<PostPlayScreen {...baseProps} nextItem={movieItem} />);
    expect(screen.queryByText(/^S\d+\s*E\d+/)).not.toBeInTheDocument();
  });

  it("renders synopsis when provided (truncation handled by CSS)", () => {
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        synopsis="Walter White returns to confront unfinished business."
      />,
    );
    expect(
      screen.getByText("Walter White returns to confront unfinished business."),
    ).toBeInTheDocument();
  });

  it("renders episode progress line", () => {
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        episodeProgress={{ episodeNumber: 5, totalEpisodes: 13, seasonNumber: 2 }}
      />,
    );
    expect(screen.getByText("Episode 5 of 13 in Season 2")).toBeInTheDocument();
  });

  it("renders playlist context line", () => {
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={movieItem}
        playlistContext={{ name: "Date Night", position: 3, total: 7 }}
      />,
    );
    expect(screen.getByText("Item 3 of 7 in Date Night")).toBeInTheDocument();
  });

  it("renders watched indicator when watched=true", () => {
    render(
      <PostPlayScreen {...baseProps} nextItem={episodeItem} watched />,
    );
    expect(screen.getByText("WATCHED")).toBeInTheDocument();
  });

  it("does not render watched indicator by default", () => {
    render(<PostPlayScreen {...baseProps} nextItem={episodeItem} />);
    expect(screen.queryByText("WATCHED")).not.toBeInTheDocument();
  });

  it("surfaces a season-transition banner when current and next seasons differ", () => {
    const finale: QueueItem = {
      ...episodeItem,
      ratingKey: "ep-1",
      subtitle: "S02E10 · Season 2 Finale",
      title: "Season 2 Finale",
    };
    const premiere: QueueItem = {
      ...episodeItem,
      ratingKey: "ep-2",
      subtitle: "S03E01 · Season 3 Premiere",
      title: "Season 3 Premiere",
    };
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={premiere}
        currentItem={finale}
      />,
    );
    expect(screen.getByText("Starting Season 3")).toBeInTheDocument();
  });

  it("renders countdown progress bar with aria attrs and decrements over time", () => {
    render(<PostPlayScreen {...baseProps} nextItem={episodeItem} />);

    expect(screen.getByText("Auto-playing in 10s")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: /auto-play countdown/i });
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("10");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText("Auto-playing in 7s")).toBeInTheDocument();
  });

  it("hides countdown UI when autoPlayEnabled is false", () => {
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        autoPlayEnabled={false}
      />,
    );
    expect(screen.queryByText(/Auto-playing in/)).not.toBeInTheDocument();
  });

  it("triggers onPlayNext after the 10s countdown completes", () => {
    const onPlayNext = vi.fn();
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        onPlayNext={onPlayNext}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onPlayNext).toHaveBeenCalled();
  });

  it("respects a custom countdownSeconds prop", () => {
    const onPlayNext = vi.fn();
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        onPlayNext={onPlayNext}
        countdownSeconds={3}
      />,
    );
    expect(screen.getByText("Auto-playing in 3s")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onPlayNext).toHaveBeenCalled();
  });

  it("invokes onPlayNext when Enter is pressed", () => {
    const onPlayNext = vi.fn();
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        onPlayNext={onPlayNext}
        autoPlayEnabled={false}
      />,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onPlayNext).toHaveBeenCalled();
  });

  it("invokes onStop when Escape is pressed", () => {
    const onStop = vi.fn();
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        onStop={onStop}
        autoPlayEnabled={false}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onStop).toHaveBeenCalled();
  });

  // ── prexu-bgz.21: input guard ─────────────────────────────────────────────

  it("does NOT call onPlayNext when Enter fires while an <input> is the target", () => {
    const onPlayNext = vi.fn();
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        onPlayNext={onPlayNext}
        autoPlayEnabled={false}
      />,
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    // Fire on the element so it bubbles to window with the correct target.
    fireEvent.keyDown(input, { key: "Enter", bubbles: true });
    expect(onPlayNext).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("does NOT call onStop when Escape fires while a <textarea> is the target", () => {
    const onStop = vi.fn();
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        onStop={onStop}
        autoPlayEnabled={false}
      />,
    );
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    fireEvent.keyDown(textarea, { key: "Escape", bubbles: true });
    expect(onStop).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it("does NOT call onPlayNext when Enter fires while a contentEditable is the target", () => {
    const onPlayNext = vi.fn();
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        onPlayNext={onPlayNext}
        autoPlayEnabled={false}
      />,
    );
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    fireEvent.keyDown(div, { key: "Enter", bubbles: true });
    expect(onPlayNext).not.toHaveBeenCalled();
    document.body.removeChild(div);
  });

  it("does NOT call onStop when Escape fires while a <select> is the target", () => {
    const onStop = vi.fn();
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        onStop={onStop}
        autoPlayEnabled={false}
      />,
    );
    const select = document.createElement("select");
    document.body.appendChild(select);
    fireEvent.keyDown(select, { key: "Escape", bubbles: true });
    expect(onStop).not.toHaveBeenCalled();
    document.body.removeChild(select);
  });

  it("invokes onPlayNext when Play Now button is clicked", () => {
    const onPlayNext = vi.fn();
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        onPlayNext={onPlayNext}
        autoPlayEnabled={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /play now/i }));
    expect(onPlayNext).toHaveBeenCalled();
  });

  it("toggles auto-play preference via the checkbox", () => {
    const onAutoPlayChange = vi.fn();
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        onAutoPlayChange={onAutoPlayChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onAutoPlayChange).toHaveBeenCalledWith(false);
  });

  it("renders inline keyboard shortcut hint", () => {
    render(<PostPlayScreen {...baseProps} nextItem={episodeItem} />);
    expect(screen.getByText(/Enter to play/i)).toBeInTheDocument();
    expect(screen.getByText(/Esc to stop/i)).toBeInTheDocument();
  });

  it("renders air date when provided", () => {
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        airDate="2013-09-29"
      />,
    );
    expect(screen.getByText("2013-09-29")).toBeInTheDocument();
  });

  it("renders directors as a 'Directed by' line when provided", () => {
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        directors={["Vince Gilligan"]}
      />,
    );
    expect(screen.getByText(/Directed by/i)).toBeInTheDocument();
    expect(screen.getByText(/Vince Gilligan/)).toBeInTheDocument();
  });

  it("renders cast as a 'Starring' line when provided", () => {
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        cast={["Bryan Cranston", "Aaron Paul", "Anna Gunn"]}
      />,
    );
    expect(screen.getByText(/Starring/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Bryan Cranston, Aaron Paul, Anna Gunn/),
    ).toBeInTheDocument();
  });

  it("does not render Directed by / Starring rows when arrays are empty", () => {
    render(
      <PostPlayScreen
        {...baseProps}
        nextItem={episodeItem}
        directors={[]}
        cast={[]}
      />,
    );
    expect(screen.queryByText(/Directed by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Starring/i)).not.toBeInTheDocument();
  });
});
