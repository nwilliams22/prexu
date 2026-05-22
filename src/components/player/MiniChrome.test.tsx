import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MiniChrome from "./MiniChrome";
import type { MiniRect } from "../../utils/mini-rect";

vi.mock("../../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

const defaultRect: MiniRect = {
  corner: "bottom-right",
  width: 360,
  height: 200,
  padding: 16,
};

const baseProps = {
  isPlaying: false,
  onTogglePlay: vi.fn(),
  onRestore: vi.fn(),
  onClose: vi.fn(),
  visible: true,
  onActivity: vi.fn(),
  onMouseMove: vi.fn(),
  miniRect: defaultRect,
  onUpdateMiniRect: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Stable viewport for snap-distance tests.
  Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 1080, configurable: true });
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

// ── Resize handle (prexu-7il.5) ─────────────────────────────────────────────
describe("MiniChrome resize handle", () => {
  it("renders the resize handle at the corner OPPOSITE the active anchor", () => {
    const { rerender } = render(<MiniChrome {...baseProps} />);
    // bottom-right anchor → handle at top-left
    let handle = screen.getByTestId("mini-chrome-resize");
    expect(handle.style.top).not.toBe("");
    expect(handle.style.left).not.toBe("");
    expect(handle.style.bottom).toBe("");
    expect(handle.style.right).toBe("");

    // top-left anchor → handle at bottom-right
    rerender(
      <MiniChrome
        {...baseProps}
        miniRect={{ ...defaultRect, corner: "top-left" }}
      />,
    );
    handle = screen.getByTestId("mini-chrome-resize");
    expect(handle.style.bottom).not.toBe("");
    expect(handle.style.right).not.toBe("");
    expect(handle.style.top).toBe("");
    expect(handle.style.left).toBe("");
  });

  it("dragging the resize handle calls onUpdateMiniRect with the clamped new size", () => {
    const onUpdateMiniRect = vi.fn();
    render(<MiniChrome {...baseProps} onUpdateMiniRect={onUpdateMiniRect} />);
    const handle = screen.getByTestId("mini-chrome-resize");

    // bottom-right anchor → handle is at top-left → dragging LEFT/UP enlarges.
    fireEvent.mouseDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 50 }); // dx=-50, dy=-50
    fireEvent.mouseUp(window, { clientX: 50, clientY: 50 });

    // Final commit on mouseup. Width = 360 + 50 = 410, height = 200 + 50 = 250.
    const lastCall = onUpdateMiniRect.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({ width: 410, height: 250 });
  });

  it("resize from top-left anchor enlarges when dragging DOWN/RIGHT", () => {
    const onUpdateMiniRect = vi.fn();
    render(
      <MiniChrome
        {...baseProps}
        miniRect={{ ...defaultRect, corner: "top-left" }}
        onUpdateMiniRect={onUpdateMiniRect}
      />,
    );
    const handle = screen.getByTestId("mini-chrome-resize");
    fireEvent.mouseDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 130 }); // dx=+50, dy=+30
    fireEvent.mouseUp(window, { clientX: 150, clientY: 130 });

    const lastCall = onUpdateMiniRect.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({ width: 410, height: 230 });
  });

  it("resize clamps to the per-axis minimum", () => {
    const onUpdateMiniRect = vi.fn();
    render(<MiniChrome {...baseProps} onUpdateMiniRect={onUpdateMiniRect} />);
    const handle = screen.getByTestId("mini-chrome-resize");
    // Try to shrink dramatically: bottom-right anchor + drag RIGHT/DOWN
    // shrinks the box. Drag far enough to push below the minimum.
    fireEvent.mouseDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 600, clientY: 500 });
    fireEvent.mouseUp(window, { clientX: 600, clientY: 500 });
    const lastCall = onUpdateMiniRect.mock.calls.at(-1)?.[0];
    expect(lastCall.width).toBe(240); // MIN_MINI_WIDTH
    expect(lastCall.height).toBe(135); // MIN_MINI_HEIGHT
  });

  it("clicking the resize handle does not trigger onRestore on the region", () => {
    const onRestore = vi.fn();
    render(<MiniChrome {...baseProps} onRestore={onRestore} />);
    const handle = screen.getByTestId("mini-chrome-resize");
    fireEvent.mouseDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: 100, clientY: 100 });
    expect(onRestore).not.toHaveBeenCalled();
  });

  // prexu-lhs regression: shrink resize moves the cursor INTO the
  // mini chrome's root region. mouseup is on window; the synthetic
  // click that follows lands on the root and would call onRestore.
  it("shrink-resize (mouseup over root region, then click on root) does NOT trigger onRestore", () => {
    const onRestore = vi.fn();
    const onUpdateMiniRect = vi.fn();
    render(
      <MiniChrome
        {...baseProps}
        onRestore={onRestore}
        onUpdateMiniRect={onUpdateMiniRect}
      />,
    );
    const handle = screen.getByTestId("mini-chrome-resize");
    const region = screen.getByTestId("mini-chrome");
    // bottom-right anchor → handle at top-left → dragging RIGHT/DOWN shrinks.
    fireEvent.mouseDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 300 });
    fireEvent.mouseUp(window, { clientX: 400, clientY: 300 });
    // Browser dispatches click on the common ancestor (the root region).
    fireEvent.click(region);
    expect(onRestore).not.toHaveBeenCalled();
    // The resize commit still fires its size update.
    const sizeCall = onUpdateMiniRect.mock.calls.find(
      ([arg]) => typeof arg.width === "number" && typeof arg.height === "number",
    );
    expect(sizeCall).toBeTruthy();
  });
});

// ── Anchor-drag (prexu-7il.7) ───────────────────────────────────────────────
describe("MiniChrome anchor drag", () => {
  it("a short mousedown→mouseup on the region (no real movement) is treated as a click → onRestore", () => {
    const onRestore = vi.fn();
    const onUpdateMiniRect = vi.fn();
    render(
      <MiniChrome
        {...baseProps}
        onRestore={onRestore}
        onUpdateMiniRect={onUpdateMiniRect}
      />,
    );
    const region = screen.getByTestId("mini-chrome");
    fireEvent.mouseDown(region, { button: 0, clientX: 1800, clientY: 1000 });
    fireEvent.mouseUp(window, { clientX: 1800, clientY: 1000 });
    fireEvent.click(region);
    expect(onUpdateMiniRect).not.toHaveBeenCalled();
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("moving the cursor far enough crosses the drag threshold and renders the ghost", () => {
    render(<MiniChrome {...baseProps} />);
    const region = screen.getByTestId("mini-chrome");
    fireEvent.mouseDown(region, { button: 0, clientX: 1800, clientY: 1000 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    expect(screen.getByTestId("mini-chrome-ghost")).toBeTruthy();
  });

  it("releasing in the top-left quadrant snaps to top-left", () => {
    const onUpdateMiniRect = vi.fn();
    render(<MiniChrome {...baseProps} onUpdateMiniRect={onUpdateMiniRect} />);
    const region = screen.getByTestId("mini-chrome");
    // Start near the active anchor (bottom-right), drag up-left, release in tl.
    fireEvent.mouseDown(region, { button: 0, clientX: 1800, clientY: 1000 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: 100, clientY: 100 });
    expect(onUpdateMiniRect).toHaveBeenCalledWith({ corner: "top-left" });
  });

  // prexu-lhs regression: anchor-drag also dispatches a synthetic click
  // after mouseup. The user just committed a corner change — we don't
  // want that click to also trigger onRestore.
  it("committed anchor-drag (followed by browser-synthesized click) does NOT trigger onRestore", () => {
    const onRestore = vi.fn();
    const onUpdateMiniRect = vi.fn();
    render(
      <MiniChrome
        {...baseProps}
        onRestore={onRestore}
        onUpdateMiniRect={onUpdateMiniRect}
      />,
    );
    const region = screen.getByTestId("mini-chrome");
    fireEvent.mouseDown(region, { button: 0, clientX: 1800, clientY: 1000 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: 100, clientY: 100 });
    fireEvent.click(region);
    expect(onUpdateMiniRect).toHaveBeenCalledWith({ corner: "top-left" });
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("releasing in the bottom-left quadrant snaps to bottom-left", () => {
    const onUpdateMiniRect = vi.fn();
    render(<MiniChrome {...baseProps} onUpdateMiniRect={onUpdateMiniRect} />);
    const region = screen.getByTestId("mini-chrome");
    fireEvent.mouseDown(region, { button: 0, clientX: 1800, clientY: 1000 });
    fireEvent.mouseMove(window, { clientX: 80, clientY: 1020 });
    fireEvent.mouseUp(window, { clientX: 80, clientY: 1020 });
    expect(onUpdateMiniRect).toHaveBeenCalledWith({ corner: "bottom-left" });
  });

  it("releasing the ghost clears the preview overlay", () => {
    render(<MiniChrome {...baseProps} />);
    const region = screen.getByTestId("mini-chrome");
    fireEvent.mouseDown(region, { button: 0, clientX: 1800, clientY: 1000 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    expect(screen.queryByTestId("mini-chrome-ghost")).not.toBeNull();
    fireEvent.mouseUp(window, { clientX: 200, clientY: 200 });
    expect(screen.queryByTestId("mini-chrome-ghost")).toBeNull();
  });

  it("right-click (button !== 0) on the region does NOT start a drag", () => {
    const onUpdateMiniRect = vi.fn();
    render(<MiniChrome {...baseProps} onUpdateMiniRect={onUpdateMiniRect} />);
    const region = screen.getByTestId("mini-chrome");
    fireEvent.mouseDown(region, { button: 2, clientX: 1800, clientY: 1000 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(window, { clientX: 200, clientY: 200 });
    expect(onUpdateMiniRect).not.toHaveBeenCalled();
  });

  it("mousedown on a chrome button does NOT start an anchor drag", () => {
    const onUpdateMiniRect = vi.fn();
    render(<MiniChrome {...baseProps} onUpdateMiniRect={onUpdateMiniRect} />);
    const closeBtn = screen.getByRole("button", { name: /close player/i });
    fireEvent.mouseDown(closeBtn, { button: 0, clientX: 1800, clientY: 1000 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(window, { clientX: 200, clientY: 200 });
    expect(onUpdateMiniRect).not.toHaveBeenCalled();
  });
});
