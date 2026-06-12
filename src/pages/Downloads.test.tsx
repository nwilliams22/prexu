import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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
