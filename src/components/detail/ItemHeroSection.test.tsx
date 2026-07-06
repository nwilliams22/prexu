import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../contexts/PlayerContext", () => ({
  usePlayerSession: () => ({ play: vi.fn() }),
}));

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ server: null, authToken: null, activeUser: null }),
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
  art: "/library/metadata/67632/art",
  thumb: "/library/metadata/67632/thumb",
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

// prexu-xl4l: third iteration on the entry-flash issue. PRs #63 (revalidation
// no longer resets state) and #73 (shelf skeletons reserve space) fixed two
// real mechanisms, but hardware still showed a refresh-like flash. Audit
// traced it to the backdrop <img>: it was marked `loading="lazy"` even
// though it's the very first, full-bleed, above-the-fold pixel content on
// the page — native lazy-loading defers the fetch behind a layout pass
// instead of starting it immediately, and no `decoding="async"` hint meant
// the browser could block the commit on a synchronous decode of a large
// 1920x1080 image. The poster/thumb also had no reserved box (only a CSS
// `width`, no `aspectRatio`), so its arrival could grow the hero row's
// height and push everything below it down.
describe("image rendering on entry (prexu-xl4l)", () => {
  it("renders the backdrop eagerly with async decode so its fetch/decode is never deferred behind first paint", () => {
    renderHero();
    const backdrop = screen.getByTestId("hero-backdrop");
    expect(backdrop).toHaveAttribute("loading", "eager");
    expect(backdrop).toHaveAttribute("decoding", "async");
  });

  it("renders the poster eagerly with async decode", () => {
    renderHero();
    const poster = screen.getByAltText("Test Movie");
    expect(poster).toHaveAttribute("loading", "eager");
    expect(poster).toHaveAttribute("decoding", "async");
  });

  it("reserves the poster's box via aspect-ratio so its arrival cannot grow the hero row height", () => {
    renderHero();
    const poster = screen.getByAltText("Test Movie") as HTMLImageElement;
    expect(poster.style.aspectRatio).toBe("2 / 3");
  });

  it("keeps the backdrop and poster src stable across re-renders of the same item (no accidental reload)", () => {
    const { rerender, container } = renderHero();
    const backdropBefore = screen.getByTestId("hero-backdrop").getAttribute("src");
    const posterBefore = screen.getByAltText("Test Movie").getAttribute("src");

    // Re-render with a *different function reference* for artUrl/posterUrl
    // (simulating ItemDetail re-rendering without memo/useCallback) but the
    // same underlying item — the computed src text must not change, or the
    // browser would treat it as a new image and re-fetch/re-decode it.
    rerender(
      <MemoryRouter>
        <ItemHeroSection
          item={MOVIE}
          artUrl={(p) => `${p}`}
          posterUrl={(p) => `${p}`}
          isAdmin={false}
          onFixMatch={() => {}}
          refreshItem={() => {}}
          serverUri="https://server.example:32400"
          serverToken="tok"
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("hero-backdrop")).toHaveAttribute("src", backdropBefore);
    expect(screen.getByAltText("Test Movie")).toHaveAttribute("src", posterBefore);
    expect(container).toBeTruthy();
  });

  it("logs the hero's own commit and the backdrop's load once each, tagged detail, so a hardware repro can pinpoint which is slow", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    renderHero();
    const committedCall = debugSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("ItemHeroSection: hero committed"),
    );
    expect(committedCall).toBeTruthy();
    expect(committedCall?.[0]).toContain("[detail]");

    const backdrop = screen.getByTestId("hero-backdrop");
    fireEvent.load(backdrop);
    fireEvent.load(backdrop); // a second load event must not double-log

    const loadCalls = debugSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("hero backdrop image loaded"),
    );
    expect(loadCalls).toHaveLength(1);
    expect(loadCalls[0][0]).toContain("[detail]");

    debugSpy.mockRestore();
  });
});
