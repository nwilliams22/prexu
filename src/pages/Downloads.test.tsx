import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockMetadata = vi.fn();
vi.mock("../services/plex-library", () => ({
  getImageUrl: () => "",
  getItemMetadata: (...args: unknown[]) => mockMetadata(...args),
}));

const mockInvoke = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://server.example:32400", accessToken: "tok" },
  }),
}));

const mockUseDownloads = vi.fn();
vi.mock("../hooks/useDownloads", () => ({
  useDownloads: () => mockUseDownloads(),
}));

vi.mock("../contexts/PlayerContext", () => ({
  usePlayerSession: () => ({ play: vi.fn() }),
}));

import Downloads from "./Downloads";

function downloadsCtx(downloads: unknown[] = []) {
  return {
    downloads,
    isDownloaded: vi.fn(),
    isDownloading: vi.fn(),
    getDownload: vi.fn(),
    queueDownload: vi.fn(),
    cancelDownload: vi.fn(),
    deleteDownload: vi.fn(),
    retryDownload: vi.fn(),
  };
}

beforeEach(() => {
  mockInvoke.mockClear();
  mockMetadata.mockReset();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

describe("Downloads page — open folder button", () => {
  it("renders on the empty state and invokes open_downloads_dir", () => {
    mockUseDownloads.mockReturnValue(downloadsCtx([]));
    render(
      <MemoryRouter>
        <Downloads />
      </MemoryRouter>,
    );

    const btn = screen.getByRole("button", { name: /Open folder/ });
    fireEvent.click(btn);
    expect(mockInvoke).toHaveBeenCalledWith("open_downloads_dir");
  });

  it("renders alongside the list when downloads exist", () => {
    mockUseDownloads.mockReturnValue(
      downloadsCtx([
        {
          ratingKey: "67632",
          title: "Sync",
          subtitle: "2024",
          type: "movie",
          thumb: "/thumb",
          partKey: "/p",
          fileName: "sync.mp4",
          fileSize: 1000,
          serverUri: "https://server.example:32400",
          status: "complete",
          bytesDownloaded: 1000,
        },
      ]),
    );
    render(
      <MemoryRouter>
        <Downloads />
      </MemoryRouter>,
    );

    expect(screen.getByText("Sync")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open folder/ }));
    expect(mockInvoke).toHaveBeenCalledWith("open_downloads_dir");
  });
});

function fixture(ratingKey: string, overrides = {}) {
  return { ratingKey, title: ratingKey, subtitle: "S01E01", type: "episode", thumb: "", partKey: "", fileName: "qa.mp4", fileSize: 1024, bytesDownloaded: 1024, serverUri: "https://server.example:32400", status: "complete", grandparentTitle: "QA show", parentIndex: 1, index: 1, ...overrides };
}

function showDownloads(items: unknown[]) {
  const context = downloadsCtx(items);
  mockUseDownloads.mockReturnValue(context);
  render(<MemoryRouter><Downloads /></MemoryRouter>);
  return context;
}

describe("grouped downloads", () => {
  it("pins active items, retains failed Retry, and groups movies and TV seasons with size", () => {
    const context = showDownloads([fixture("movie", { type: "movie" }), fixture("episode-one"), fixture("episode-two", { parentIndex: 2 }), fixture("active", { status: "queued" }), fixture("failed", { status: "error" })]);
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(["Downloads", "Downloading (1)", "Failed", "Movies (1)", "TV shows", "QA show — 2.0 KB"]);
    expect(screen.getByText("Season 1 (1)")).toBeInTheDocument();
    expect(screen.getByText("Season 2 (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Retry download"));
    expect(context.retryDownload).toHaveBeenCalledWith("failed");
  });

  it("requires confirmation, allows cancellation, and limits Delete all to this show", () => {
    const context = showDownloads([fixture("one"), fixture("two", { parentIndex: 2 }), fixture("movie", { type: "movie" }), fixture("other", { grandparentTitle: "Other" })]);
    const show = screen.getByRole("region", { name: "QA show" });
    const trigger = within(show).getByRole("button", { name: "Delete all" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(context.deleteDownload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(within(show).getByRole("button", { name: "Delete all" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete downloads" }));
    expect(context.deleteDownload.mock.calls).toEqual([["one"], ["two"]]);
  });

  it("checks watched state and confirms only watched completed episodes", async () => {
    mockMetadata.mockImplementation((_uri, _token, key) => Promise.resolve({ viewCount: key === "watched" ? 1 : 0 }));
    const context = showDownloads([fixture("watched"), fixture("unwatched"), fixture("queued", { status: "queued" })]);
    fireEvent.click(screen.getByRole("button", { name: "Delete watched" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("watched S01E01")).toBeInTheDocument();
    expect(within(dialog).queryByText("unwatched S01E01")).not.toBeInTheDocument();
    expect(context.deleteDownload).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete downloads" }));
    expect(context.deleteDownload.mock.calls).toEqual([["watched"]]);
    expect(mockMetadata).toHaveBeenCalledTimes(2);
  });

  it("does not delete anything if a watched-state lookup fails", async () => {
    mockMetadata.mockResolvedValueOnce({ viewCount: 1 }).mockRejectedValueOnce(new Error("offline"));
    const context = showDownloads([fixture("one"), fixture("two")]);
    fireEvent.click(screen.getByRole("button", { name: "Delete watched" }));
    expect(await screen.findByText(/Could not check watched status/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(context.deleteDownload).not.toHaveBeenCalled();
  });

  it("reports when no watched downloads exist", async () => {
    mockMetadata.mockResolvedValue({ viewCount: 0 });
    showDownloads([fixture("unwatched")]);
    fireEvent.click(screen.getByRole("button", { name: "Delete watched" }));
    expect(await screen.findByText("No watched downloads in this show.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
