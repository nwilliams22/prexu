import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DownloadsProvider, type DownloadsContextValue } from "../../hooks/useDownloads";
import type { DownloadItem } from "../../types/downloads";
import DownloadQueue from "./DownloadQueue";

function item(ratingKey: string, status: DownloadItem["status"]): DownloadItem {
  return { ratingKey, title: ratingKey, subtitle: "S01E01", type: "episode", thumb: "", partKey: "/part", fileName: "qa.mkv", fileSize: 4096, bytesDownloaded: 1024, serverUri: "https://qa.example", status, bytesPerSecond: 1024, etaSeconds: 3 };
}
function setup(downloads = [item("First", "downloading"), item("Second", "queued"), item("Third", "paused")]) {
  const context: DownloadsContextValue = {
    downloads, pauseDownload: vi.fn(), resumeDownload: vi.fn(), pauseAll: vi.fn(), resumeAll: vi.fn(), reorderDownloads: vi.fn(), cancelDownload: vi.fn(), deleteDownload: vi.fn(), retryDownload: vi.fn(), queueDownload: vi.fn(), isDownloaded: vi.fn(), isDownloading: vi.fn(), getDownload: vi.fn(), concurrency: 1, setConcurrency: vi.fn(), bytesPerSecond: 1024, etaSeconds: 6,
  };
  const view = render(<DownloadsProvider value={context}><DownloadQueue /></DownloadsProvider>);
  return { context, user: userEvent.setup(), ...view };
}

describe("download queue", () => {
  it("shows paused items, transfer progress, per-item and overall estimates", () => {
    setup();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Paused · 1.0 KB / 4.0 KB")).toBeInTheDocument();
    expect(screen.getByText("1.0 KB/s · 3s left")).toBeInTheDocument();
    expect(screen.getByText("1.0 KB/s overall · 6s left (excludes paused items)")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Download progress for First" })).toHaveAttribute("value", "25");
  });
  it("routes per-item and bulk controls to the engine context", async () => {
    const { context, user } = setup();
    await user.click(screen.getByRole("button", { name: "Pause First" }));
    await user.click(screen.getByRole("button", { name: "Pause Second" }));
    await user.click(screen.getByRole("button", { name: "Resume Third" }));
    await user.click(screen.getByRole("button", { name: "Cancel Third" }));
    await user.click(screen.getByRole("button", { name: "Pause all" }));
    await user.click(screen.getByRole("button", { name: "Resume all" }));
    expect(context.pauseDownload.mock.calls).toEqual([["First"], ["Second"]]);
    expect(context.resumeDownload).toHaveBeenCalledWith("Third");
    expect(context.cancelDownload).toHaveBeenCalledWith("Third");
    expect(context.pauseAll).toHaveBeenCalledOnce();
    expect(context.resumeAll).toHaveBeenCalledOnce();
  });
  it("reorders only pending items and prevents moves beyond either end", async () => {
    const { context, user } = setup([item("Complete", "complete"), item("First", "paused"), item("Second", "queued"), item("Failed", "error")]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Move First up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Second down" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move Second up" }));
    expect(context.reorderDownloads).toHaveBeenLastCalledWith(["Second", "First"]);
    await user.click(screen.getByRole("button", { name: "Move First down" }));
    expect(context.reorderDownloads).toHaveBeenLastCalledWith(["Second", "First"]);
  });
  it("updates controls when state changes and permits keyboard activation", async () => {
    const { context, user, rerender } = setup([item("First", "queued")]);
    expect(screen.getByRole("button", { name: "Resume all" })).toBeDisabled();
    const pause = screen.getByRole("button", { name: "Pause First" });
    pause.focus();
    await user.keyboard("{Enter}");
    expect(context.pauseDownload).toHaveBeenCalledWith("First");
    rerender(<DownloadsProvider value={{ ...context, downloads: [item("First", "paused")] }}><DownloadQueue /></DownloadsProvider>);
    expect(screen.getByRole("button", { name: "Pause all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume all" })).toBeEnabled();
    expect(screen.getByText("All downloads paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume First" })).toBeEnabled();
  });
  it("does not invent progress or ETA for an unknown size", () => {
    setup([{ ...item("Unknown", "downloading"), fileSize: 0, bytesPerSecond: 0, etaSeconds: null }]);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText(/Unknown size/)).toBeInTheDocument();
    expect(within(row).getByText("0 B/s · Estimating time left…")).toBeInTheDocument();
    expect(within(row).getByRole("progressbar")).not.toHaveAttribute("value");
  });
  it("hides the queue after all items finish", () => {
    setup([item("Finished", "complete")]);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
