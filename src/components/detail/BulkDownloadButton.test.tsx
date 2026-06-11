import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockQueueDownload = vi.fn();
const mockIsDownloaded = vi.fn().mockReturnValue(false);
const mockIsDownloading = vi.fn().mockReturnValue(false);

vi.mock("../../hooks/useDownloads", () => ({
  useDownloads: () => ({
    queueDownload: mockQueueDownload,
    isDownloaded: mockIsDownloaded,
    isDownloading: mockIsDownloading,
    getDownload: vi.fn(),
    downloads: [],
    cancelDownload: vi.fn(),
    deleteDownload: vi.fn(),
    retryDownload: vi.fn(),
  }),
}));

import BulkDownloadButton from "./BulkDownloadButton";
import type { PlexEpisode } from "../../types/library";

const SERVER_URI = "https://server.example:32400";

function makeEpisode(ratingKey: string, sizeBytes: number): PlexEpisode {
  return {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    type: "episode",
    title: `Episode ${ratingKey}`,
    grandparentTitle: "Show",
    parentIndex: 1,
    index: Number(ratingKey),
    thumb: "/thumb",
    Media: [
      {
        id: 1,
        Part: [
          {
            id: 100 + Number(ratingKey),
            key: `/library/parts/${ratingKey}/file.mkv`,
            file: `/media/show/s01e0${ratingKey}.mkv`,
            size: sizeBytes,
          },
        ],
      },
    ],
  } as unknown as PlexEpisode;
}

beforeEach(() => {
  mockQueueDownload.mockClear();
  mockIsDownloaded.mockReturnValue(false);
  mockIsDownloading.mockReturnValue(false);
});

describe("BulkDownloadButton", () => {
  it("shows a confirm dialog with episode count and total size, queues on confirm", async () => {
    const episodes = [makeEpisode("1", 1024 ** 3), makeEpisode("2", 1024 ** 3)];
    render(
      <BulkDownloadButton
        label="Download Season"
        noun="season"
        serverUri={SERVER_URI}
        getEpisodes={async () => episodes}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Download Season/ }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText(/2 episodes/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 GB/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Download 2/ }));
    expect(mockQueueDownload).toHaveBeenCalledTimes(2);
    expect(mockQueueDownload.mock.calls.map((c) => c[0].ratingKey)).toEqual(["1", "2"]);
    // Dialog closed after confirm
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancel closes the dialog without queueing", async () => {
    render(
      <BulkDownloadButton
        label="Download Series"
        noun="series"
        serverUri={SERVER_URI}
        getEpisodes={async () => [makeEpisode("1", 1000)]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Download Series/ }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockQueueDownload).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("skips already-downloaded episodes and says so", async () => {
    mockIsDownloaded.mockImplementation((rk: string) => rk === "1");
    render(
      <BulkDownloadButton
        label="Download Season"
        noun="season"
        serverUri={SERVER_URI}
        getEpisodes={async () => [makeEpisode("1", 1000), makeEpisode("2", 1000)]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Download Season/ }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText(/1 episode\b/)).toBeInTheDocument();
    expect(screen.getByText(/1 already downloaded/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Download 1/ }));
    expect(mockQueueDownload).toHaveBeenCalledTimes(1);
    expect(mockQueueDownload.mock.calls[0][0].ratingKey).toBe("2");
  });

  it("episodes without part data are excluded", async () => {
    const broken = { ...makeEpisode("3", 0), Media: [] } as PlexEpisode;
    render(
      <BulkDownloadButton
        label="Download Season"
        noun="season"
        serverUri={SERVER_URI}
        getEpisodes={async () => [broken]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Download Season/ }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText(/Nothing to download/)).toBeInTheDocument();
  });
});
