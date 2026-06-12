import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockSearchSubtitles = vi.fn();
const mockDownloadSubtitle = vi.fn();

vi.mock("../../services/subtitle-search", () => ({
  searchSubtitles: (...args: unknown[]) => mockSearchSubtitles(...args),
  downloadSubtitle: (...args: unknown[]) => mockDownloadSubtitle(...args),
  setSelectedSubtitleStream: vi.fn(),
}));

import SubtitleSearchPanel from "./SubtitleSearchPanel";
import type { PlexStream } from "../../types/library";

const TRACKS: PlexStream[] = [
  {
    id: 7,
    streamType: 3,
    codec: "srt",
    index: 0,
    displayTitle: "Unknown",
  },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof SubtitleSearchPanel>> = {}) {
  const props = {
    serverUri: "https://server.example:32400",
    serverToken: "tok",
    ratingKey: "67632",
    subtitleTracks: TRACKS,
    onSelectTrack: vi.fn(),
    selectedSubtitleId: null,
    onSubtitleDownloaded: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<SubtitleSearchPanel {...props} />), props };
}

beforeEach(() => {
  mockSearchSubtitles.mockReset();
  mockDownloadSubtitle.mockReset();
});

describe("SubtitleSearchPanel", () => {
  it("clicking an embedded track calls onSelectTrack with the stream id", () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByText("Unknown"));
    expect(props.onSelectTrack).toHaveBeenCalledWith(7);
  });

  it("clicking None calls onSelectTrack with null", () => {
    const { props } = renderPanel({ selectedSubtitleId: 7 });
    fireEvent.click(screen.getByText("None"));
    expect(props.onSelectTrack).toHaveBeenCalledWith(null);
  });

  it("shows the source file name and language for downloaded external tracks", () => {
    renderPanel({
      subtitleTracks: [
        ...TRACKS,
        {
          id: 99,
          streamType: 3,
          codec: "srt",
          index: 1,
          displayTitle: "Spanish",
          title: "Movie.2026.spa.srt",
          language: "Spanish",
        },
      ],
    });
    expect(screen.getByText("Movie.2026.spa.srt")).toBeInTheDocument();
    expect(screen.getByText(/Spanish · SRT/)).toBeInTheDocument();
  });

  it("falls back to displayTitle for embedded tracks without a title", () => {
    renderPanel();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("marks the selected track via aria-selected", () => {
    renderPanel({ selectedSubtitleId: 7 });
    expect(screen.getByRole("option", { name: /Unknown/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders search results returned by the service", async () => {
    mockSearchSubtitles.mockResolvedValue([
      {
        id: "101",
        key: "/library/streams/101",
        fileName: "Movie.2026.srt",
        language: "English",
        format: "srt",
        hearingImpaired: false,
        matchConfidence: 0.92,
        provider: "OpenSubtitles",
      },
    ]);
    renderPanel();
    fireEvent.click(screen.getByText("Search Online"));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(screen.getByText("Movie.2026.srt")).toBeInTheDocument();
    });
    expect(screen.getByText(/92% match/)).toBeInTheDocument();
  });

  it("shows a 'no subtitles found' message after a search with zero results", async () => {
    mockSearchSubtitles.mockResolvedValue([]);
    renderPanel();
    fireEvent.click(screen.getByText("Search Online"));
    expect(
      screen.getByText("Select a language and click Search to find subtitles"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(
        screen.getByText("No subtitles found for this language"),
      ).toBeInTheDocument();
    });
  });

  it("shows the error message when search fails", async () => {
    mockSearchSubtitles.mockRejectedValue(new Error("Plex API error: 500"));
    renderPanel();
    fireEvent.click(screen.getByText("Search Online"));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(screen.getByText("Plex API error: 500")).toBeInTheDocument();
    });
  });

  it("side variant renders its own backdrop and a compact anchored panel", () => {
    const { container } = renderPanel();
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.position).toBe("absolute");
    expect(dialog.style.maxHeight).not.toBe("");
    // backdrop is the dialog's previous sibling
    expect(container.querySelectorAll("div").length).toBeGreaterThan(0);
    expect(dialog.previousElementSibling).not.toBeNull();
  });

  it("side variant opts back into pointer events (player layer is pointerEvents:none)", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.previousElementSibling as HTMLElement;
    expect(dialog.style.pointerEvents).toBe("auto");
    expect(backdrop.style.pointerEvents).toBe("auto");
  });

  it("modal variant renders no backdrop and no absolute positioning", () => {
    renderPanel({ variant: "modal" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.position).toBe("");
    expect(dialog.previousElementSibling).toBeNull();
  });

  it("does not mix borderBottom shorthand with borderBottomColor on the active tab", () => {
    renderPanel();
    const activeTab = screen.getByRole("button", { name: /Embedded/ });
    // React warns if both shorthand and longhand are present across rerenders;
    // the active style must fully override the shorthand instead.
    expect(activeTab.style.borderBottom).toContain("var(--accent)");
    fireEvent.click(screen.getByText("Search Online"));
    expect(activeTab.style.borderBottom).toContain("transparent");
  });
});
