import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { emitWatchStateChanged } from "../../services/watch-state-events";
const state = vi.hoisted(() => ({
  server: { uri: "https://qa.invalid", accessToken: "test" },
  downloads: [{ ratingKey: "2", serverUri: "https://qa.invalid", status: "complete", completedAt: 1 }],
  session: null as { ratingKey: string } | null,
  remove: vi.fn(), metadata: vi.fn(),
}));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ server: state.server }) }));
vi.mock("../../hooks/useDownloads", () => ({ useDownloads: () => ({ downloads: state.downloads, deleteDownload: state.remove }) }));
vi.mock("../../contexts/PlayerContext", () => ({ usePlayerSession: () => ({ session: state.session }) }));
vi.mock("../../services/plex-library", () => ({ getItemMetadata: state.metadata }));
import { DownloadCleanup } from "./DownloadCleanup";
beforeEach(() => {
  localStorage.clear();
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  state.session = null;
  state.downloads = [{ ratingKey: "2", serverUri: "https://qa.invalid", status: "complete", completedAt: 1 }];
  state.remove.mockReset().mockResolvedValue(undefined);
  state.metadata.mockReset().mockResolvedValue({ ratingKey: "2", viewCount: 1, lastViewedAt: 1 });
});
afterEach(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });
it("does nothing while disabled", async () => {
  render(<DownloadCleanup />);
  await act(async () => {});
  expect(state.metadata).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
});
it("removes an eligible download on launch", async () => {
  localStorage.setItem("prexu.autoDeleteWatchedDownloads", "true");
  render(<DownloadCleanup />);
  await waitFor(() => expect(state.remove).toHaveBeenCalledWith("2"));
});
it.each(["playing", "unwatched", "other-server", "fresh-download", "missing-time", "failed-fetch"])("keeps %s downloads", async (reason) => {
  localStorage.setItem("prexu.autoDeleteWatchedDownloads", "true");
  if (reason === "playing") state.session = { ratingKey: "2" };
  if (reason === "unwatched") state.metadata.mockResolvedValue({ ratingKey: "2", viewCount: 0, lastViewedAt: 1 });
  if (reason === "other-server") state.downloads[0].serverUri = "https://other.invalid";
  if (reason === "fresh-download") state.downloads[0].completedAt = Date.now();
  if (reason === "missing-time") state.metadata.mockResolvedValue({ ratingKey: "2", viewCount: 1 });
  if (reason === "failed-fetch") state.metadata.mockRejectedValue(new Error("offline"));
  render(<DownloadCleanup />);
  await act(async () => {});
  expect(state.remove).not.toHaveBeenCalled();
});
it.each(["setting-off", "watch-event", "unmount"])("rechecks safety after async metadata: %s", async (reason) => {
  localStorage.setItem("prexu.autoDeleteWatchedDownloads", "true");
  let resolve!: (value: unknown) => void;
  state.metadata.mockReturnValue(new Promise(r => { resolve = r; }));
  const { unmount } = render(<DownloadCleanup />);
  if (reason === "setting-off") localStorage.setItem("prexu.autoDeleteWatchedDownloads", "false");
  if (reason === "watch-event") emitWatchStateChanged("2");
  if (reason === "unmount") unmount();
  await act(async () => { resolve({ ratingKey: "2", viewCount: 1, lastViewedAt: 1 }); });
  expect(state.remove).not.toHaveBeenCalled();
});

it("uses the original offline watch time when a previous session syncs on launch", async () => {
  localStorage.setItem("prexu.autoDeleteWatchedDownloads", "true");
  let resolve!: (value: unknown) => void;
  state.metadata.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<DownloadCleanup />);
  emitWatchStateChanged("2", undefined, 1);
  await act(async () => { resolve({ ratingKey: "2", viewCount: 1, lastViewedAt: Date.now() / 1000 }); });
  expect(state.remove).toHaveBeenCalledWith("2");
});

it("rechecks launch eligibility after an offline watch finishes syncing", async () => {
  localStorage.setItem("prexu.autoDeleteWatchedDownloads", "true");
  state.metadata.mockResolvedValueOnce({ ratingKey: "2", viewCount: 0 });
  render(<DownloadCleanup />);
  await act(async () => {});
  expect(state.remove).not.toHaveBeenCalled();
  state.metadata.mockResolvedValue({ ratingKey: "2", viewCount: 1, lastViewedAt: Date.now() / 1000 });
  act(() => emitWatchStateChanged("2", undefined, 1));
  await waitFor(() => expect(state.remove).toHaveBeenCalledWith("2"));
});
