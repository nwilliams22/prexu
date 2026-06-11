import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockOpenContextMenu = vi.fn();

vi.mock("../../hooks/useMediaContextMenu", () => ({
  useMediaContextMenu: () => ({
    openContextMenu: mockOpenContextMenu,
    overlays: null,
  }),
}));

vi.mock("../../hooks/usePlayAction", () => ({
  usePlayAction: () => ({
    getPlayHandler: () => undefined,
    playOverlay: null,
  }),
}));

import EpisodeListSection from "./EpisodeListSection";
import type { PlexEpisode } from "../../types/library";

const EPISODE = {
  ratingKey: "19937",
  key: "/library/metadata/19937",
  type: "episode",
  title: "Surprised to be Dead",
  index: 1,
  thumb: "/thumb",
  duration: 1440000,
  summary: "Yusuke has a typical day.",
} as unknown as PlexEpisode;

beforeEach(() => {
  mockOpenContextMenu.mockClear();
});

describe("EpisodeListSection context menu", () => {
  it("right-clicking an episode row opens the media context menu", () => {
    render(
      <MemoryRouter>
        <EpisodeListSection
          episodes={[EPISODE]}
          seasonFading={false}
          episodeThumbUrl={(p) => p}
          formatDuration={() => "24m"}
        />
      </MemoryRouter>,
    );

    const row = screen.getByText("Surprised to be Dead").closest("div")!;
    const event = fireEvent.contextMenu(row);
    expect(mockOpenContextMenu).toHaveBeenCalledTimes(1);
    expect(mockOpenContextMenu.mock.calls[0][1]).toBe(EPISODE);
    // Browser default menu suppressed
    expect(event).toBe(false);
  });
});
