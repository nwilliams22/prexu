import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../contexts/PlayerContext", () => ({
  usePlayerSession: () => ({ play: vi.fn() }),
}));

vi.mock("../../hooks/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useToast")>()),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("./DownloadButton", () => ({
  default: () => null,
}));

vi.mock("../../hooks/usePreferences", () => ({
  usePreferences: () => ({
    preferences: {
      playback: {
        subtitleSize: 100,
        subtitleStyle: {
          fontFamily: "sans-serif",
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          backgroundOpacity: 0.75,
          outlineColor: "#000000",
          outlineWidth: 2,
          shadowEnabled: true,
        },
      },
    },
    updatePreferences: vi.fn(),
  }),
}));

const mockSearchSubtitles = vi.fn();
const mockDownloadSubtitle = vi.fn();
const mockSetSelectedSubtitleStream = vi.fn();
const mockGetItemMetadata = vi.fn();

vi.mock("../../services/subtitle-search", () => ({
  searchSubtitles: (...args: unknown[]) => mockSearchSubtitles(...args),
  downloadSubtitle: (...args: unknown[]) => mockDownloadSubtitle(...args),
  setSelectedSubtitleStream: (...args: unknown[]) =>
    mockSetSelectedSubtitleStream(...args),
}));

vi.mock("../../services/plex-library", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/plex-library")>()),
  getItemMetadata: (...args: unknown[]) => mockGetItemMetadata(...args),
}));

import ItemHeroSection from "./ItemHeroSection";
import type { PlexMovie } from "../../types/library";

const MOVIE = {
  ratingKey: "67632",
  key: "/library/metadata/67632",
  type: "movie",
  title: "Test Movie",
  year: 2026,
  duration: 5400000,
  Media: [
    {
      id: 1,
      Part: [
        {
          id: 5523,
          key: "/library/parts/5523",
          Stream: [
            { id: 7, streamType: 3, codec: "srt", index: 0, displayTitle: "Unknown" },
          ],
        },
      ],
    },
  ],
} as unknown as PlexMovie;

function renderHero() {
  return render(
    <MemoryRouter>
      <ItemHeroSection
        item={MOVIE}
        artUrl={(p) => p}
        posterUrl={(p) => p}
        isAdmin={false}
        onFixMatch={() => {}}
        refreshItem={() => {}}
        serverUri="https://server.example:32400"
        serverToken="tok"
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockSearchSubtitles.mockReset();
  mockDownloadSubtitle.mockReset();
  mockSetSelectedSubtitleStream.mockReset();
  mockGetItemMetadata.mockReset();
});

describe("ItemHeroSection subtitle modal", () => {
  it("portals the subtitle dialog overlay directly under document.body", () => {
    const { container } = renderHero();
    fireEvent.click(screen.getByRole("button", { name: /Search & Download Subtitles/ }));

    const dialog = screen.getByRole("dialog", { name: "Subtitle search" });
    // Portal escape: dialog must NOT live inside the hero's render tree,
    // and its overlay root must be a direct child of document.body so no
    // ancestor stacking context can paint page content above it.
    expect(container.contains(dialog)).toBe(false);
    let overlayRoot: HTMLElement = dialog;
    while (overlayRoot.parentElement && overlayRoot.parentElement !== document.body) {
      overlayRoot = overlayRoot.parentElement;
    }
    expect(overlayRoot.parentElement).toBe(document.body);
  });

  it("closes the dialog when the backdrop overlay is clicked", () => {
    renderHero();
    fireEvent.click(screen.getByRole("button", { name: /Search & Download Subtitles/ }));
    const dialog = screen.getByRole("dialog", { name: "Subtitle search" });
    let overlayRoot: HTMLElement = dialog;
    while (overlayRoot.parentElement && overlayRoot.parentElement !== document.body) {
      overlayRoot = overlayRoot.parentElement;
    }
    fireEvent.click(overlayRoot);
    expect(screen.queryByRole("dialog", { name: "Subtitle search" })).toBeNull();
  });

  it("refreshes the embedded list and selects the new track after a download", async () => {
    mockSearchSubtitles.mockResolvedValue([
      {
        id: "101",
        key: "/library/streams/101",
        fileName: "Movie.2026.spa.srt",
        language: "Spanish",
        format: "srt",
        hearingImpaired: false,
        matchConfidence: null,
        provider: "OpenSubtitles",
      },
    ]);
    mockDownloadSubtitle.mockResolvedValue(undefined);
    mockSetSelectedSubtitleStream.mockResolvedValue(undefined);
    // First poll already includes the downloaded stream (id 8)
    mockGetItemMetadata.mockResolvedValue({
      ...MOVIE,
      Media: [
        {
          id: 1,
          Part: [
            {
              id: 5523,
              key: "/library/parts/5523",
              Stream: [
                { id: 7, streamType: 3, codec: "srt", index: 0, displayTitle: "Unknown" },
                {
                  id: 8,
                  streamType: 3,
                  codec: "srt",
                  index: 1,
                  displayTitle: "Spanish",
                  title: "Movie.2026.spa.srt",
                  language: "Spanish",
                },
              ],
            },
          ],
        },
      ],
    });

    renderHero();
    fireEvent.click(screen.getByRole("button", { name: /Search & Download Subtitles/ }));
    fireEvent.click(screen.getByText("Search Online"));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const downloadBtn = await screen.findByRole("button", { name: "↓" });
    fireEvent.click(downloadBtn);

    // Plex deletes unselected on-demand downloads — the new stream must be
    // selected on the server immediately after it appears in metadata.
    await waitFor(() => {
      expect(mockSetSelectedSubtitleStream).toHaveBeenCalledWith(
        "https://server.example:32400",
        "tok",
        5523,
        8,
      );
    });

    // Embedded tab now shows the downloaded track without reopening the modal
    fireEvent.click(screen.getByRole("button", { name: /Embedded \(2\)/ }));
    expect(screen.getByText("Movie.2026.spa.srt")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Movie\.2026\.spa\.srt/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
