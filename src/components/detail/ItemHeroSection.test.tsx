import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

vi.mock("../../services/subtitle-search", () => ({
  searchSubtitles: vi.fn(),
  downloadSubtitle: vi.fn(),
  setSelectedSubtitleStream: vi.fn(),
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
});
