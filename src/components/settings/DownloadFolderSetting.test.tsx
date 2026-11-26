import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), choose: vi.fn(), move: vi.fn(), listen: vi.fn(), pause: vi.fn(), stop: vi.fn() }));
vi.mock("../../services/downloads", () => ({ getDownloadsDir: mocks.get, chooseDownloadsFolder: mocks.choose, moveDownloadsFolder: mocks.move, onDownloadMoveProgress: mocks.listen }));
vi.mock("../../hooks/useDownloads", () => ({ useDownloads: () => ({ pauseAll: mocks.pause }) }));
import { DownloadFolderSetting } from "./DownloadFolderSetting";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue("/old/Prexu");
  mocks.choose.mockResolvedValue("/new");
  mocks.move.mockResolvedValue("/new/Prexu");
  mocks.listen.mockResolvedValue(mocks.stop);
});
it("requires confirmation, pauses transfers, then displays the committed folder", async () => {
  render(<DownloadFolderSetting />);
  await screen.findByText("/old/Prexu");
  fireEvent.click(screen.getByRole("button", { name: "Download folder" }));
  fireEvent.click(await screen.findByRole("button", { name: "Move downloads" }));
  await screen.findByText("/new/Prexu");
  expect(mocks.pause).toHaveBeenCalledOnce();
  expect(mocks.move).toHaveBeenCalledWith("/new");
  expect(mocks.stop).toHaveBeenCalledOnce();
});
it("cancels folder selection without pausing or moving", async () => {
  mocks.choose.mockResolvedValue(null);
  render(<DownloadFolderSetting />);
  await screen.findByText("/old/Prexu");
  fireEvent.click(screen.getByRole("button", { name: "Download folder" }));
  await waitFor(() => expect(mocks.choose).toHaveBeenCalledOnce());
  expect(mocks.pause).not.toHaveBeenCalled();
  expect(mocks.move).not.toHaveBeenCalled();
});
it("retains the old path and shows a migration failure", async () => {
  mocks.move.mockRejectedValue(new Error("Copy verification failed"));
  render(<DownloadFolderSetting />);
  await screen.findByText("/old/Prexu");
  fireEvent.click(screen.getByRole("button", { name: "Download folder" }));
  fireEvent.click(await screen.findByRole("button", { name: "Move downloads" }));
  await screen.findByText("Error: Copy verification failed");
  expect(screen.getByText("/old/Prexu")).toBeInTheDocument();
  expect(mocks.stop).toHaveBeenCalledOnce();
});
