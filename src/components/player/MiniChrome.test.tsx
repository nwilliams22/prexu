import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MiniChrome from "./MiniChrome";

const baseProps = {
  isPlaying: false,
  onTogglePlay: vi.fn(),
  onRestore: vi.fn(),
  onClose: vi.fn(),
  visible: true,
  onActivity: vi.fn(),
  onMouseMove: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MiniChrome", () => {
  it("renders restore, close, and play buttons by default", () => {
    render(<MiniChrome {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /restore to full player/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /close player/i }),
    ).toBeTruthy();
    // Exact match — `/play/i` would also match "Restore to full PLAYer".
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("shows the pause icon (aria-label Pause) when isPlaying=true", () => {
    render(<MiniChrome {...baseProps} isPlaying={true} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("clicking the restore button calls onRestore and onActivity, not onClose or onTogglePlay", () => {
    const onRestore = vi.fn();
    const onClose = vi.fn();
    const onTogglePlay = vi.fn();
    const onActivity = vi.fn();
    render(
      <MiniChrome
        {...baseProps}
        onRestore={onRestore}
        onClose={onClose}
        onTogglePlay={onTogglePlay}
        onActivity={onActivity}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /restore to full player/i }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onTogglePlay).not.toHaveBeenCalled();
  });

  it("clicking the close button calls onClose and onActivity only", () => {
    const onClose = vi.fn();
    const onRestore = vi.fn();
    const onActivity = vi.fn();
    render(
      <MiniChrome
        {...baseProps}
        onClose={onClose}
        onRestore={onRestore}
        onActivity={onActivity}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /close player/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("clicking the play button calls onTogglePlay and onActivity, not onRestore", () => {
    const onTogglePlay = vi.fn();
    const onRestore = vi.fn();
    const onActivity = vi.fn();
    render(
      <MiniChrome
        {...baseProps}
        onTogglePlay={onTogglePlay}
        onRestore={onRestore}
        onActivity={onActivity}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("clicking the transparent region (root, not a button) calls onRestore — Plex convention", () => {
    const onRestore = vi.fn();
    render(<MiniChrome {...baseProps} onRestore={onRestore} />);
    fireEvent.click(screen.getByTestId("mini-chrome"));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("button clicks do not bubble up to trigger the region's restore", () => {
    // When a user clicks the close button, the close handler should fire
    // and the region's onRestore must NOT also fire. This protects the
    // top-cluster buttons from accidentally double-firing because the
    // bubble-up would land on the region's click handler.
    const onRestore = vi.fn();
    const onClose = vi.fn();
    render(
      <MiniChrome {...baseProps} onRestore={onRestore} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close player/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("sets visible=false → top and bottom clusters opacity 0 + pointer-events none", () => {
    render(<MiniChrome {...baseProps} visible={false} />);
    const top = screen.getByTestId("mini-chrome-top");
    const bottom = screen.getByTestId("mini-chrome-bottom");
    expect(top.style.opacity).toBe("0");
    expect(top.style.pointerEvents).toBe("none");
    expect(bottom.style.opacity).toBe("0");
    expect(bottom.style.pointerEvents).toBe("none");
  });

  it("forwards title to the region's native tooltip", () => {
    render(<MiniChrome {...baseProps} title="Alice in Borderland — S01E01" />);
    expect(screen.getByTestId("mini-chrome").title).toBe(
      "Alice in Borderland — S01E01",
    );
  });

  it("forwards onMouseMove to the region root", () => {
    const onMouseMove = vi.fn();
    render(<MiniChrome {...baseProps} onMouseMove={onMouseMove} />);
    fireEvent.mouseMove(screen.getByTestId("mini-chrome"));
    expect(onMouseMove).toHaveBeenCalledTimes(1);
  });
});
