import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const setConcurrency = vi.hoisted(() => vi.fn());
vi.mock("../../hooks/useDownloads", () => ({ useDownloads: () => ({ concurrency: 1, setConcurrency }) }));
import { DownloadSettingsPanel } from "./DownloadSettingsPanel";
it("offers the three supported device concurrency limits", () => {
  render(<DownloadSettingsPanel />);
  const select = screen.getByRole("combobox", { name: "Simultaneous downloads" });
  expect(select).toHaveValue("1");
  expect(screen.getAllByRole("option")).toHaveLength(3);
  fireEvent.change(select, { target: { value: "3" } });
  expect(setConcurrency).toHaveBeenCalledWith(3);
});
it("keeps automatic deletion off by default and persists opt-in", () => {
  localStorage.clear();
  render(<DownloadSettingsPanel />);
  const toggle = screen.getByRole("checkbox", { name: "Auto-delete watched downloads" });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(toggle).toBeChecked();
  expect(localStorage.getItem("prexu.autoDeleteWatchedDownloads")).toBe("true");
  fireEvent.click(toggle);
  expect(localStorage.getItem("prexu.autoDeleteWatchedDownloads")).toBe("false");
});
