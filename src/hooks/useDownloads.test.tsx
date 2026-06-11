import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

afterEach(() => {
  vi.useRealTimers();
});

/** Mount the hook and flush the initial getDownloadItems load, which would
 *  otherwise resolve after queueDownload and wipe queued state. */
async function renderSettled() {
  const utils = renderHook(() => useDownloadsState(SERVER));
  await act(async () => {});
  return utils;
}

describe("useDownloadsState queue", () => {
  it("serializes downloads — only one runs at a time", async () => {
    mockStartDownload.mockReturnValue(new Promise(() => {})); // never settles
    const { result } = await renderSettled();

    act(() => {
      result.current.queueDownload(makeItem("a"));
      result.current.queueDownload(makeItem("b"));
    });

    await waitFor(() => {
      expect(mockStartDownload).toHaveBeenCalledTimes(1);
    });
    expect(mockStartDownload.mock.calls[0][2]).toBe("a");
    expect(result.current.getDownload("b")?.status).toBe("queued");
  });

  it("retries with backoff up to 3 times, then surfaces the error", async () => {
    vi.useFakeTimers();
    mockStartDownload.mockRejectedValue(new Error("error decoding response body"));
    const { result } = renderHook(() => useDownloadsState(SERVER));
    await act(async () => {}); // settle initial storage load

    act(() => {
      result.current.queueDownload(makeItem("a"));
    });
    await act(async () => {}); // first attempt fails

    expect(mockStartDownload).toHaveBeenCalledTimes(1);
    // Backoff holds the item — no immediate restart
    await act(async () => {});
    expect(mockStartDownload).toHaveBeenCalledTimes(1);

    // 1s → attempt 2, 3s → attempt 3, 8s → attempt 4 (last), then error
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockStartDownload).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockStartDownload).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(mockStartDownload).toHaveBeenCalledTimes(4);
    expect(result.current.getDownload("a")?.status).toBe("error");
    expect(result.current.getDownload("a")?.errorMessage).toContain(
      "error decoding response body",
    );
  });

  it("manual retryDownload resets the auto-retry budget", async () => {
    vi.useFakeTimers();
    mockStartDownload.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useDownloadsState(SERVER));
    await act(async () => {});

    act(() => {
      result.current.queueDownload(makeItem("a"));
    });
    await act(async () => {});
    for (const delay of [1000, 3000, 8000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
      await act(async () => {});
    }
    expect(mockStartDownload).toHaveBeenCalledTimes(4);
    expect(result.current.getDownload("a")?.status).toBe("error");

    act(() => {
      result.current.retryDownload("a");
    });
    await act(async () => {});
    // Fresh budget: manual retry starts attempt 5 immediately
    expect(mockStartDownload).toHaveBeenCalledTimes(5);
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
