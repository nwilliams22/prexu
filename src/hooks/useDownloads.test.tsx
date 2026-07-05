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
// processor and persistence logic under test do not, so leave it unset
// except in the "download-progress event toasts" describe block below.
const { eventHandlers } = vi.hoisted(() => {
  const handlers: Record<string, ((evt: { payload: unknown }) => void)[]> = {};
  return { eventHandlers: handlers };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, handler: (evt: { payload: unknown }) => void) => {
      if (!eventHandlers[name]) eventHandlers[name] = [];
      eventHandlers[name].push(handler);
      return () => {
        const list = eventHandlers[name] ?? [];
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
  ),
}));

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

const mockToast = vi.fn();

beforeEach(() => {
  mockStartDownload.mockReset();
  mockSaveDownloadItems.mockClear();
  mockGetDownloadItems.mockResolvedValue([]);
  mockToast.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Mount the hook and flush the initial getDownloadItems load, which would
 *  otherwise resolve after queueDownload and wipe queued state. */
async function renderSettled() {
  const utils = renderHook(() => useDownloadsState(SERVER, mockToast));
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

  it("retries with backoff up to 3 times, then surfaces the error and toasts failure exactly once", async () => {
    vi.useFakeTimers();
    mockStartDownload.mockRejectedValue(new Error("error decoding response body"));
    const { result } = renderHook(() => useDownloadsState(SERVER, mockToast));
    await act(async () => {}); // settle initial storage load

    act(() => {
      result.current.queueDownload(makeItem("a"));
    });
    await act(async () => {}); // first attempt fails

    expect(mockStartDownload).toHaveBeenCalledTimes(1);
    // Backoff holds the item — no immediate restart
    await act(async () => {});
    expect(mockStartDownload).toHaveBeenCalledTimes(1);
    // Auto-retries are silent — no toast yet.
    expect(mockToast).not.toHaveBeenCalled();

    // 1s → attempt 2, 3s → attempt 3, 8s → attempt 4 (last), then error
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockStartDownload).toHaveBeenCalledTimes(2);
    expect(mockToast).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockStartDownload).toHaveBeenCalledTimes(3);
    expect(mockToast).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(mockStartDownload).toHaveBeenCalledTimes(4);
    expect(result.current.getDownload("a")?.status).toBe("error");
    expect(result.current.getDownload("a")?.errorMessage).toContain(
      "error decoding response body",
    );
    // Failure toast fires exactly once, only after retries exhaust.
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("download failed"),
      "error",
    );
    expect(mockToast.mock.calls[0][0]).toContain(makeItem("a").title);
  });

  it("manual retryDownload resets the auto-retry budget", async () => {
    vi.useFakeTimers();
    mockStartDownload.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useDownloadsState(SERVER, mockToast));
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

describe("useDownloadsState download-progress event toasts", () => {
  beforeEach(() => {
    for (const k of Object.keys(eventHandlers)) delete eventHandlers[k];
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  function fireProgress(payload: {
    ratingKey: string;
    bytesDownloaded: number;
    totalBytes: number;
    status: string;
    errorMessage?: string;
  }) {
    const handlers = eventHandlers["download-progress"] ?? [];
    for (const h of handlers) h({ payload });
  }

  /** Renders the hook and waits for the async `listen()` registration
   *  (dynamic `import("@tauri-apps/api/event")` inside a useEffect) to
   *  land, so tests don't race the mock's own async resolution. */
  async function renderSettledWithListener() {
    const utils = await renderSettled();
    await waitFor(() => {
      expect(eventHandlers["download-progress"]?.length).toBeGreaterThan(0);
    });
    return utils;
  }

  it("shows a success toast with the item title when a download completes", async () => {
    mockStartDownload.mockReturnValue(new Promise(() => {}));
    const { result } = await renderSettledWithListener();

    act(() => {
      result.current.queueDownload(makeItem("a"));
    });
    await waitFor(() => {
      expect(result.current.getDownload("a")?.status).toBe("downloading");
    });

    act(() => {
      fireProgress({
        ratingKey: "a",
        bytesDownloaded: 1000,
        totalBytes: 1000,
        status: "complete",
      });
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining(makeItem("a").title),
      "success",
    );
  });

  it("does not toast on a user-initiated cancel", async () => {
    mockStartDownload.mockReturnValue(new Promise(() => {}));
    const { result } = await renderSettledWithListener();

    act(() => {
      result.current.queueDownload(makeItem("a"));
    });
    await waitFor(() => {
      expect(result.current.getDownload("a")?.status).toBe("downloading");
    });

    act(() => {
      result.current.cancelDownload("a");
    });
    act(() => {
      fireProgress({
        ratingKey: "a",
        bytesDownloaded: 500,
        totalBytes: 1000,
        status: "cancelled",
      });
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does not toast on a raw error event still pending auto-retry — only the exhausted-retries path does", async () => {
    mockStartDownload.mockReturnValue(new Promise(() => {}));
    const { result } = await renderSettledWithListener();

    act(() => {
      result.current.queueDownload(makeItem("a"));
    });
    await waitFor(() => {
      expect(result.current.getDownload("a")?.status).toBe("downloading");
    });

    act(() => {
      fireProgress({
        ratingKey: "a",
        bytesDownloaded: 0,
        totalBytes: 1000,
        status: "error",
        errorMessage: "transient",
      });
    });

    expect(mockToast).not.toHaveBeenCalled();
  });
});
