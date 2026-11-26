import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SyncIndicator from "./SyncIndicator";

describe("SyncIndicator", () => {
  it("shows catching up while a late joiner buffers", () => {
    render(<SyncIndicator syncStatus="synced" participantCount={2} catchingUp />);
    expect(screen.getByRole("status")).toHaveTextContent("Catching up…");
  });
  it("renders with role status", () => {
    render(<SyncIndicator syncStatus="synced" participantCount={2} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it('displays "Synced" label when synced', () => {
    render(<SyncIndicator syncStatus="synced" participantCount={1} />);
    expect(screen.getByText("Synced")).toBeInTheDocument();
  });

  it('displays "Syncing..." label when syncing', () => {
    render(<SyncIndicator syncStatus="syncing" participantCount={3} />);
    expect(screen.getByText("Syncing...")).toBeInTheDocument();
  });

  it('displays "Disconnected" label when disconnected', () => {
    render(<SyncIndicator syncStatus="disconnected" participantCount={0} />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("shows singular viewer for count of 1", () => {
    render(<SyncIndicator syncStatus="synced" participantCount={1} />);
    expect(screen.getByText("1 viewer")).toBeInTheDocument();
  });

  it("shows plural viewers for count other than 1", () => {
    render(<SyncIndicator syncStatus="synced" participantCount={3} />);
    expect(screen.getByText("3 viewers")).toBeInTheDocument();
  });

  it("shows plural viewers for count of 0", () => {
    render(<SyncIndicator syncStatus="disconnected" participantCount={0} />);
    expect(screen.getByText("0 viewers")).toBeInTheDocument();
  });

  it("has aria-live polite for accessibility", () => {
    render(<SyncIndicator syncStatus="synced" participantCount={2} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("renders the colored dot", () => {
    const { container } = render(
      <SyncIndicator syncStatus="synced" participantCount={1} />
    );
    // The dot is the first child div inside the status container
    const statusEl = screen.getByRole("status");
    const dot = statusEl.querySelector("div");
    expect(dot).toBeInTheDocument();
    expect(dot!.style.background).toBe("var(--success)");
  });

  it("uses accent color for syncing dot", () => {
    const { container } = render(
      <SyncIndicator syncStatus="syncing" participantCount={2} />
    );
    const statusEl = screen.getByRole("status");
    const dot = statusEl.querySelector("div");
    expect(dot!.style.background).toBe("var(--accent)");
  });

  it("uses error color for disconnected dot", () => {
    const { container } = render(
      <SyncIndicator syncStatus="disconnected" participantCount={0} />
    );
    const statusEl = screen.getByRole("status");
    const dot = statusEl.querySelector("div");
    expect(dot!.style.background).toBe("var(--error)");
  });
});

it("shows drift recovery and gives host grace priority", () => {
  const { rerender } = render(<SyncIndicator syncStatus="synced" participantCount={2} resyncing />);
  expect(screen.getByText("Re-syncing")).toBeInTheDocument();
  rerender(<SyncIndicator syncStatus="synced" participantCount={2} struggling />);
  expect(screen.getByText("Having trouble keeping up")).toBeInTheDocument();
  rerender(<SyncIndicator syncStatus="synced" participantCount={2} waitingForHost struggling catchingUp />);
  expect(screen.getByText("Waiting for host...")).toBeInTheDocument();
});
