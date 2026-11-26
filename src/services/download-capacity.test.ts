import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { confirmDownloadCapacity, requiredDownloadBytes } from "./download-capacity";
import type { DownloadItem } from "../types/downloads";
const storage = vi.hoisted(() => vi.fn());
vi.mock("./downloads", () => ({ getDownloadStorage: storage }));
const item = (fileSize: number, bytesDownloaded = 0, status = "queued"): DownloadItem => ({
  ratingKey: "1", fileSize, bytesDownloaded, status,
} as DownloadItem);
beforeEach(() => {
  storage.mockReset();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
it("uses remaining bytes of active and paused downloads, not completed files", () => {
  expect(requiredDownloadBytes([item(100)], [item(500, 200, "paused"), item(1000, 1000, "complete"), item(100, 10, "downloading")])).toBe(490);
});
it("permits an exact fit without a dialog", async () => {
  storage.mockResolvedValue({ freeBytes: 100 });
  expect(await confirmDownloadCapacity([item(100)], [])).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("asks before downloading when the drive cannot be checked", async () => {
  storage.mockRejectedValue(new Error("unavailable"));
  const result = confirmDownloadCapacity([item(100)], []);
  await screen.findByRole("dialog");
  expect(screen.getByText(/Could not check free space/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(await result).toBe(false);
});
it("does not silently treat an unknown size as zero", async () => {
  storage.mockResolvedValue({ freeBytes: 100 });
  const result = confirmDownloadCapacity([item(0)], []);
  await screen.findByRole("dialog");
  expect(screen.getByText(/sizes are unknown/)).toBeInTheDocument();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(await result).toBe(false);
});
