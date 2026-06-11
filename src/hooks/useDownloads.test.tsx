import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockStartDownload = vi.fn();
const mockCancelDownload = vi.fn().mockResolvedValue(undefined);
const mockDeleteDownload = vi.fn().mockResolvedValue(undefined);
const mockSaveDownloadItems = vi.fn().mockResolvedValue(undefined);
const mockGetDownloadItems = vi.fn().mockResolvedValue([]);

vi.mock("../services/downloads", () => ({
  startDownload: (...args: unknown[]) => mockStartDownload(...args),
  cancelDownload: (...args: unknown[]) => mockCancelDownload(...args),
  deleteDownload: (...args: unknown[]) => mockDeleteDownload(...args),
}));

vi.mock("../services/storage", () => ({
  getDownloadItems: (...args: unknown[]) => mockGetDownloadItems(...args),
  saveDownloadItems: (...args: unknown[]) => mockSaveDownloadItems(...args),
}));

// Progress listener path requires the Tauri runtime marker; the queue
// processor and persistence logic under test do not, so leave it unset.

import { useDownloadsState } from "./useDownloads";
import type { DownloadItem } from "../types/downloads";

const SERVER = { uri: "https://server.example:32400", accessToken: "tok" };

function makeItem(ratingKey: string): DownloadItem {
  return {
    ratingKey,
    title: `Item ${ratingKey}`,
    subtitle: "2026",
    type: "movie",
    thumb: "/thumb",
    partKey: `/library/parts/${ratingKey}/file.mp4`,
    fileName: `${ratingKey}.mp4`,
    fileSize: 1000,
    serverUri: SERVER.uri,
    status: "queued",
    bytesDownloaded: 0,
  };
}

beforeEach(() => {
  mockStartDownload.mockReset();
  mockSaveDownloadItems.mockClear();
  mockGetDownloadItems.mockResolvedValue([]);
});

/** Mount the hook and flush the initial getDownloadItems load, which would
 *  otherwise resolve after queueDownload and wipe queued state. */
async function renderSettled() {
  const utils = renderHook(() => useDownloadsState(SERVER));
  await act(async () => {});
  return utils;
}

describe("useDownloadsState queue", () => {
  it("starts at most MAX_CONCURRENT downloads in parallel", async () => {
    mockStartDownload.mockReturnValue(new Promise(() => {})); // never settles
    const { result } = await renderSettled();

    act(() => {
      result.current.queueDownload(makeItem("a"));
      result.current.queueDownload(makeItem("b"));
      result.current.queueDownload(makeItem("c"));
    });

    await waitFor(() => {
      expect(mockStartDownload).toHaveBeenCalledTimes(2);
    });
    const started = mockStartDownload.mock.calls.map((c) => c[2]);
    expect(started).toEqual(["a", "b"]);
    expect(result.current.getDownload("c")?.status).toBe("queued");
  });

  it("auto-requeues once when startDownload rejects, then errors on second failure", async () => {
    mockStartDownload.mockRejectedValue(new Error("error decoding response body"));
    const { result } = await renderSettled();

    act(() => {
      result.current.queueDownload(makeItem("a"));
    });

    // First failure → auto-retry → second failure → terminal error
    await waitFor(() => {
      expect(result.current.getDownload("a")?.status).toBe("error");
    });
    expect(mockStartDownload).toHaveBeenCalledTimes(2);
    expect(result.current.getDownload("a")?.errorMessage).toContain(
      "error decoding response body",
    );
  });

  it("manual retryDownload resets the auto-retry budget", async () => {
    mockStartDownload.mockRejectedValue(new Error("boom"));
    const { result } = await renderSettled();

    act(() => {
      result.current.queueDownload(makeItem("a"));
    });
    await waitFor(() => {
      expect(result.current.getDownload("a")?.status).toBe("error");
    });
    expect(mockStartDownload).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.retryDownload("a");
    });
    // Budget reset: manual retry gets a fresh attempt plus one auto-retry
    await waitFor(() => {
      expect(mockStartDownload).toHaveBeenCalledTimes(4);
    });
  });
});

describe("useDownloadsState persistence", () => {
  it("persists on status change but not on byte-progress-only updates", async () => {
    mockStartDownload.mockReturnValue(new Promise(() => {}));
    const { result } = await renderSettled();

    act(() => {
      result.current.queueDownload(makeItem("a"));
    });
    await waitFor(() => {
      expect(result.current.getDownload("a")?.status).toBe("downloading");
    });
    // Exactly two writes: queued, then downloading. The initial empty list
    // is skipped, and re-renders without a status change must not write —
    // byte-progress ticks reuse the same signature.
    expect(mockSaveDownloadItems).toHaveBeenCalledTimes(2);
    const lastSaved = mockSaveDownloadItems.mock.calls.at(-1)![0] as DownloadItem[];
    expect(lastSaved.find((d) => d.ratingKey === "a")?.status).toBe("downloading");
  });
});
