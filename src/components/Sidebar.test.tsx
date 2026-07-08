import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Sidebar from "./Sidebar";
import { DownloadsProvider } from "../hooks/useDownloads";
import type { DownloadsContextValue } from "../hooks/useDownloads";
import type { DownloadItem } from "../types/downloads";

// ── Mocks ──
//
// useDownloads is intentionally NOT mocked: the test drives the REAL
// DownloadsContext via DownloadsProvider so the download-count subscription
// (extracted into an isolated child in prexu-9f4s.1) is genuinely exercised.
// Its service dependencies are stubbed so importing the real module is inert.
vi.mock("../services/downloads", () => ({
  startDownload: vi.fn(),
  cancelDownload: vi.fn(),
  deleteDownload: vi.fn(),
}));
vi.mock("../services/storage", () => ({
  getDownloadItems: vi.fn(() => Promise.resolve([])),
  saveDownloadItems: vi.fn(),
}));

const mockServer = { uri: "https://plex.test", accessToken: "tok", name: "Server" };
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ server: mockServer }),
}));

// useLibrary is called exactly once per Sidebar render (and by nothing else in
// this tree), so its call count is a faithful proxy for Sidebar's own render
// count. Written as a plain function so Vitest's restoreMocks can't reset it.
const mockRenderCounts = { sidebar: 0 };
const mockSections: unknown[] = [];
vi.mock("../hooks/useLibrary", () => ({
  useLibrary: () => {
    mockRenderCounts.sidebar++;
    return { sections: mockSections, isLoading: false };
  },
}));

vi.mock("../hooks/useServerHealth", () => ({
  useServerHealth: () => ({ status: "online", latencyMs: 12 }),
}));

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => "desktop",
  isTabletOrBelow: () => false,
}));

vi.mock("../services/plex-library", () => ({
  scanLibrary: vi.fn(),
  refreshLibraryMetadata: vi.fn(),
  emptyLibraryTrash: vi.fn(),
}));

vi.mock("./LibraryIcon", () => ({ default: () => <span data-testid="library-icon" /> }));
vi.mock("./ContextMenu", () => ({ default: () => <div data-testid="context-menu" /> }));
vi.mock("./UpdateNotification", () => ({ default: () => <div data-testid="update-notification" /> }));
vi.mock("./ServerHealthBadge", () => ({ default: () => <div data-testid="server-health-badge" /> }));
vi.mock("./NewBadge", () => ({ default: () => <span data-testid="new-badge" /> }));

// Stable prop identities so React.memo(Sidebar) can bail out on an unrelated
// parent re-render — inline closures here would themselves defeat the memo.
const noop = () => {};
const emptySet = new Set<string>();

function makeDownload(overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    ratingKey: "1",
    title: "Movie",
    subtitle: "2020",
    type: "movie",
    thumb: "/t",
    partKey: "/p",
    fileName: "f.mkv",
    fileSize: 1000,
    serverUri: "https://plex.test",
    status: "downloading",
    bytesDownloaded: 0,
    ...overrides,
  };
}

function makeDownloadsValue(downloads: DownloadItem[]): DownloadsContextValue {
  return {
    downloads,
    isDownloaded: () => false,
    isDownloading: () => false,
    getDownload: () => undefined,
    queueDownload: vi.fn(),
    cancelDownload: vi.fn(),
    deleteDownload: vi.fn(),
    retryDownload: vi.fn(),
  };
}

// A byte-progress tick mints a NEW downloads array (and thus a new context
// value) while leaving the active count unchanged — exactly the churn Sidebar
// must be insulated from.
function Harness({ initial }: { initial: DownloadItem[] }) {
  const [downloads, setDownloads] = useState(initial);
  return (
    <>
      <button
        data-testid="progress-tick"
        onClick={() =>
          setDownloads((prev) =>
            prev.map((d) => ({ ...d, bytesDownloaded: d.bytesDownloaded + 1 })),
          )
        }
      >
        tick
      </button>
      <DownloadsProvider value={makeDownloadsValue(downloads)}>
        <Sidebar
          collapsed={false}
          onToggle={noop}
          newSections={emptySet}
          onMarkSectionSeen={noop}
        />
      </DownloadsProvider>
    </>
  );
}

describe("Sidebar — downloads subscription isolation (prexu-9f4s.1)", () => {
  beforeEach(() => {
    mockRenderCounts.sidebar = 0;
  });

  it("does not re-render Sidebar on a byte-progress update that leaves the count unchanged", () => {
    render(
      <MemoryRouter>
        <Harness initial={[makeDownload({ status: "downloading", bytesDownloaded: 0 })]} />
      </MemoryRouter>,
    );

    const afterMount = mockRenderCounts.sidebar;
    expect(afterMount).toBeGreaterThan(0);
    // The isolated badge reflects the single active download.
    expect(screen.getByText("1")).toBeInTheDocument();

    // Two byte-progress ticks: new downloads array each time, count stays 1.
    fireEvent.click(screen.getByTestId("progress-tick"));
    fireEvent.click(screen.getByTestId("progress-tick"));

    // Sidebar's body must NOT have re-run — the churn is confined to the
    // isolated DownloadCountBadge child.
    expect(mockRenderCounts.sidebar).toBe(afterMount);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows no badge when there are no active downloads", () => {
    render(
      <MemoryRouter>
        <Harness initial={[makeDownload({ status: "complete" })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });
});
