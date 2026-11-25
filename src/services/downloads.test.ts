import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { controlDownloadQueue, startDownload } from "./downloads";

beforeEach(() => { invoke.mockClear(); (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; });
describe("download IPC contract", () => {
  it("preserves transfer arguments for resume", async () => {
    await startDownload("http://qa.invalid", "fixture", "a", "/part", "a.mkv", 100);
    expect(invoke).toHaveBeenCalledWith("download_media", { serverUrl: "http://qa.invalid", token: "fixture", ratingKey: "a", partKey: "/part", fileName: "a.mkv", fileSize: 100 });
  });
  it("forwards queue controls without changing their order", async () => {
    await controlDownloadQueue("pause", { ratingKey: "a" });
    await controlDownloadQueue("pauseAll");
    await controlDownloadQueue("resumeAll");
    await controlDownloadQueue("reorder", { order: ["c", "b"] });
    await controlDownloadQueue("limit", { limit: 3 });
    expect(invoke.mock.calls).toEqual([
      ["control_download_queue", { action: "pause", ratingKey: "a" }],
      ["control_download_queue", { action: "pauseAll" }],
      ["control_download_queue", { action: "resumeAll" }],
      ["control_download_queue", { action: "reorder", order: ["c", "b"] }],
      ["control_download_queue", { action: "limit", limit: 3 }],
    ]);
  });
  it("requires the desktop runtime", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(controlDownloadQueue("pauseAll")).rejects.toThrow("desktop app");
    expect(invoke).not.toHaveBeenCalled();
  });
});
