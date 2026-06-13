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
  currentTime: 30,
  duration: 600,
  onSeek: vi.fn(),
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

  // prexu-2rz: the transparent middle area is NOT clickable. Restore
  // happens only via the dedicated restore button — this eliminates the
  // entire class of click-after-drag bugs on shrink-resize, since the
  // synthetic click can't reach onRestore regardless of which element it
  // lands on. The prexu-lhs recentlyDraggedAtRef guard is gone too.
  it("clicking the transparent region (root, not a button) does NOT call onRestore", () => {
    const onRestore = vi.fn();
    render(<MiniChrome {...baseProps} onRestore={onRestore} />);
    fireEvent.click(screen.getByTestId("mini-chrome"));
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("clicking the close button still fires onClose without touching onRestore", () => {
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

  // prexu-vm2: the RESIZE_IPC_THROTTLE_MS gate was a no-op (both
  // branches of `if (shouldIpc)` called onUpdateMiniRect identically),
  // so every mousemove fired an IPC + a setMiniRect re-render and the
  // AppLayout mask trailed the cursor by hundreds of ms. With the throttle
  // working, a rapid burst of mousemoves (well under 50 ms apart) must
  // produce only the first mid-drag update plus the final commit.
  it("throttles mid-drag onUpdateMiniRect to ~20 Hz", () => {
    const onUpdateMiniRect = vi.fn();
    render(<MiniChrome {...baseProps} onUpdateMiniRect={onUpdateMiniRect} />);
    const handle = screen.getByTestId("mini-chrome-resize");
    fireEvent.mouseDown(handle, { button: 0, clientX: 100, clientY: 100 });
    // Five synchronous moves in the same JS tick — Date.now() will not
    // tick fast enough between them to cross the 50 ms throttle window.
    fireEvent.mouseMove(window, { clientX: 90, clientY: 90 });
    fireEvent.mouseMove(window, { clientX: 80, clientY: 80 });
    fireEvent.mouseMove(window, { clientX: 70, clientY: 70 });
    fireEvent.mouseMove(window, { clientX: 60, clientY: 60 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 50 });
    // 1 first-move update + 1 mouseup commit. Pre-fix this was 6.
    expect(onUpdateMiniRect).toHaveBeenCalledTimes(2);
    // Final commit must reflect the LAST cursor position, not the first.
    expect(onUpdateMiniRect.mock.calls.at(-1)?.[0]).toEqual({
      width: 410,
      height: 250,
    });
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

  // prexu-2rz regression: after a shrink-resize, the synthetic click
  // sometimes lands directly on the restore button (not the root). The
  // prexu-lhs ref-guard inside handleRegionClick missed this case; the
  // structural fix is that the restore button is the ONLY restore path
  // and a click on it IS the user's intent. This test asserts that even
  // when the click lands on the button, it does what the user asked —
  // the bug it's guarding against is restoreFromMinimize firing on an
  // unintentional synthetic click, which can no longer happen because
  // the only restore path is the explicit button. We assert the button
  // is reachable and its click still works (no over-zealous suppression).
  it("clicking the restore button after a resize still works (no over-suppression)", () => {
    const onRestore = vi.fn();
    render(<MiniChrome {...baseProps} onRestore={onRestore} />);
    const handle = screen.getByTestId("mini-chrome-resize");
    // Simulate a shrink-resize.
    fireEvent.mouseDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 300 });
    fireEvent.mouseUp(window, { clientX: 400, clientY: 300 });
    // User then INTENTIONALLY clicks restore. We must not have left a
    // global click-swallower around that would eat this click.
    fireEvent.click(screen.getByRole("button", { name: /restore to full player/i }));
    expect(onRestore).toHaveBeenCalledTimes(1);
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
  // prexu-2rz: short mousedown→mouseup on the region is now a no-op
  // (used to fire onRestore as a Plex-convention shortcut, removed to
  // close the click-after-drag bug class on shrink-resize).
  it("a short mousedown→mouseup on the region (no real movement) is a no-op", () => {
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
    expect(onRestore).not.toHaveBeenCalled();
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

  // prexu-ois regression: anchor-drag was selecting/highlighting the
  // dashboard cards underneath as the cursor crossed them. Fix is to
  // preventDefault on mousedown AND lock document.body.userSelect for
  // the duration of the drag. Restore on mouseup (and on cleanup).
  it("anchor-drag locks document.body.style.userSelect during the drag and restores on mouseup", () => {
    render(<MiniChrome {...baseProps} />);
    const region = screen.getByTestId("mini-chrome");
    expect(document.body.style.userSelect).toBe("");
    fireEvent.mouseDown(region, { button: 0, clientX: 1800, clientY: 1000 });
    expect(document.body.style.userSelect).toBe("none");
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
    expect(document.body.style.userSelect).toBe("none");
    fireEvent.mouseUp(window, { clientX: 100, clientY: 100 });
    expect(document.body.style.userSelect).toBe("");
  });

  it("anchor-drag mousedown calls preventDefault to inhibit browser drag-select", () => {
    render(<MiniChrome {...baseProps} />);
    const region = screen.getByTestId("mini-chrome");
    const ev = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 1800,
      clientY: 1000,
    });
    region.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    // Clean up the in-flight drag so other tests aren't affected.
    fireEvent.mouseUp(window, { clientX: 1800, clientY: 1000 });
  });

  it("resize-drag also locks userSelect during the drag", () => {
    render(<MiniChrome {...baseProps} />);
    const handle = screen.getByTestId("mini-chrome-resize");
    expect(document.body.style.userSelect).toBe("");
    fireEvent.mouseDown(handle, { button: 0, clientX: 100, clientY: 100 });
    expect(document.body.style.userSelect).toBe("none");
    fireEvent.mouseUp(window, { clientX: 200, clientY: 200 });
    expect(document.body.style.userSelect).toBe("");
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

// ── Scrub bar + ±10s skip (prexu-a6z.4) ─────────────────────────────────────
describe("MiniChrome scrub + skip", () => {
  it("renders skip-back, skip-forward, and scrub bar when duration > 0", () => {
    render(<MiniChrome {...baseProps} />);
    expect(screen.getByTestId("mini-chrome-skip-back")).toBeTruthy();
    expect(screen.getByTestId("mini-chrome-skip-forward")).toBeTruthy();
    expect(screen.getByTestId("mini-chrome-scrub")).toBeTruthy();
  });

  it("hides skip + scrub when duration is 0 (pre-metadata)", () => {
    render(<MiniChrome {...baseProps} duration={0} />);
    expect(screen.queryByTestId("mini-chrome-skip-back")).toBeNull();
    expect(screen.queryByTestId("mini-chrome-skip-forward")).toBeNull();
    expect(screen.queryByTestId("mini-chrome-scrub")).toBeNull();
  });

  it("clicking skip-forward calls onSeek with currentTime + 10", () => {
    const onSeek = vi.fn();
    render(<MiniChrome {...baseProps} onSeek={onSeek} currentTime={30} duration={600} />);
    fireEvent.click(screen.getByTestId("mini-chrome-skip-forward"));
    expect(onSeek).toHaveBeenCalledWith(40);
  });

  it("clicking skip-back calls onSeek with currentTime - 10, clamped to 0", () => {
    const onSeek = vi.fn();
    render(<MiniChrome {...baseProps} onSeek={onSeek} currentTime={5} duration={600} />);
    fireEvent.click(screen.getByTestId("mini-chrome-skip-back"));
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("skip-forward clamps to duration when overshooting", () => {
    const onSeek = vi.fn();
    render(<MiniChrome {...baseProps} onSeek={onSeek} currentTime={595} duration={600} />);
    fireEvent.click(screen.getByTestId("mini-chrome-skip-forward"));
    expect(onSeek).toHaveBeenCalledWith(600);
  });

  it("scrubbing via pointerdown calls onSeek with fraction of duration from track rect", () => {
    const onSeek = vi.fn();
    render(<MiniChrome {...baseProps} onSeek={onSeek} duration={600} />);
    const scrub = screen.getByTestId("mini-chrome-scrub");
    // The scrubTrackRef is on the first child div of the hit area. Mock its
    // getBoundingClientRect: 300px wide starting at x=50 so pointer at
    // x=200 → fraction=(200-50)/300=0.5 → seek to 300s.
    const trackDiv = scrub.firstElementChild as HTMLElement | null;
    if (trackDiv) {
      vi.spyOn(trackDiv, "getBoundingClientRect").mockReturnValue({
        left: 50, right: 350, width: 300, top: 0, bottom: 4, height: 4,
        x: 50, y: 0, toJSON: () => ({}),
      } as DOMRect);
    }
    fireEvent.pointerDown(scrub, { button: 0, clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(scrub, { button: 0, clientX: 200, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(300);
  });

  it("scrub seek is clamped to [0, duration] when pointer is outside track bounds", () => {
    const onSeek = vi.fn();
    render(<MiniChrome {...baseProps} onSeek={onSeek} duration={600} />);
    const scrub = screen.getByTestId("mini-chrome-scrub");
    const trackDiv = scrub.firstElementChild as HTMLElement | null;
    if (trackDiv) {
      vi.spyOn(trackDiv, "getBoundingClientRect").mockReturnValue({
        left: 50, right: 350, width: 300, top: 0, bottom: 4, height: 4,
        x: 50, y: 0, toJSON: () => ({}),
      } as DOMRect);
    }
    // Pointer far to the right → fraction > 1 → clamped to duration (600).
    fireEvent.pointerDown(scrub, { button: 0, clientX: 900, pointerId: 1 });
    fireEvent.pointerUp(scrub, { button: 0, clientX: 900, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(600);
  });

  // prexu-bgz.10: scrub pointermove used to call onSeek (a raw player_seek
  // IPC) on EVERY move with zero throttling, flooding the mpv command queue
  // during a drag. The fix mirrors the resize path's 33 ms leading-edge
  // Date.now() gate. A rapid burst of moves must produce at most
  // ceil(elapsed/33) mid-drag seeks (plus the pointerdown grab seek), and
  // pointerup must ALWAYS seek with the exact release position even when it
  // lands inside the throttle window.
  it("throttles mid-drag scrub seeks to ~30 Hz and always seeks the release position on pointerup", () => {
    vi.useFakeTimers();
    try {
      const onSeek = vi.fn();
      render(<MiniChrome {...baseProps} onSeek={onSeek} duration={600} />);
      const scrub = screen.getByTestId("mini-chrome-scrub");
      const trackDiv = scrub.firstElementChild as HTMLElement | null;
      if (trackDiv) {
        // 300px-wide track at x=0 → seconds = (clientX / 300) * 600.
        vi.spyOn(trackDiv, "getBoundingClientRect").mockReturnValue({
          left: 0, right: 300, width: 300, top: 0, bottom: 4, height: 4,
          x: 0, y: 0, toJSON: () => ({}),
        } as DOMRect);
      }

      fireEvent.pointerDown(scrub, { button: 0, clientX: 0, pointerId: 1 });
      // The grab itself seeks once immediately.
      expect(onSeek).toHaveBeenCalledTimes(1);

      // 30 rapid moves, 5 ms apart (150 ms total) — far faster than 33 ms.
      const MOVES = 30;
      const STEP_MS = 5;
      for (let i = 1; i <= MOVES; i++) {
        vi.advanceTimersByTime(STEP_MS);
        fireEvent.pointerMove(scrub, { clientX: i * 5, pointerId: 1 });
      }
      const elapsedMs = MOVES * STEP_MS;
      const midDragSeeks = onSeek.mock.calls.length - 1; // minus the grab seek
      // Throttled: at most one seek per 33 ms window, NOT one per move.
      expect(midDragSeeks).toBeLessThanOrEqual(Math.ceil(elapsedMs / 33) + 1);
      expect(midDragSeeks).toBeLessThan(MOVES);
      expect(midDragSeeks).toBeGreaterThan(0); // gate opens, it's not a mute

      // Release at x=150 — inside the throttle window (last move was 5 ms
      // ago) — the final seek must still fire with the exact release
      // position: (150 / 300) * 600 = 300 s.
      fireEvent.pointerUp(scrub, { clientX: 150, pointerId: 1 });
      expect(onSeek).toHaveBeenLastCalledWith(300);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skip + scrub controls all carry data-mini-no-drag so they don't start an anchor drag", () => {
    render(<MiniChrome {...baseProps} />);
    expect(
      screen.getByTestId("mini-chrome-scrub-wrap").getAttribute("data-mini-no-drag"),
    ).toBe("true");
    // skip buttons are inside mini-chrome-bottom which has data-mini-no-drag,
    // so their closest('[data-mini-no-drag="true"]') resolves to the cluster.
    const back = screen.getByTestId("mini-chrome-skip-back");
    expect(back.closest('[data-mini-no-drag="true"]')).toBeTruthy();
  });

  it("clicking skip-forward also calls onActivity", () => {
    const onActivity = vi.fn();
    render(<MiniChrome {...baseProps} onActivity={onActivity} />);
    fireEvent.click(screen.getByTestId("mini-chrome-skip-forward"));
    expect(onActivity).toHaveBeenCalled();
  });
});

// ── Time labels (prexu-oj5) ─────────────────────────────────────────────────
describe("MiniChrome time labels", () => {
  it("renders current + remaining time around the scrub bar at default width", () => {
    render(
      <MiniChrome {...baseProps} currentTime={65} duration={185} />,
    );
    expect(screen.getByTestId("mini-chrome-time-current").textContent).toBe("1:05");
    // remaining = 185 - 65 = 120, formatted as 2:00 with leading "-"
    expect(screen.getByTestId("mini-chrome-time-remaining").textContent).toBe("-2:00");
  });

  it("hides time labels below the width threshold", () => {
    render(
      <MiniChrome
        {...baseProps}
        miniRect={{ ...defaultRect, width: 260 }}
      />,
    );
    expect(screen.queryByTestId("mini-chrome-time-current")).toBeNull();
    expect(screen.queryByTestId("mini-chrome-time-remaining")).toBeNull();
    // Scrub bar itself stays present so the user can still seek.
    expect(screen.getByTestId("mini-chrome-scrub")).toBeTruthy();
  });

  it("does NOT render time labels when duration is 0 (pre-metadata / live)", () => {
    render(<MiniChrome {...baseProps} duration={0} />);
    expect(screen.queryByTestId("mini-chrome-time-current")).toBeNull();
    expect(screen.queryByTestId("mini-chrome-time-remaining")).toBeNull();
  });

  it("does NOT render time labels when duration is Infinity (live stream)", () => {
    render(
      <MiniChrome {...baseProps} duration={Number.POSITIVE_INFINITY} />,
    );
    expect(screen.queryByTestId("mini-chrome-time-current")).toBeNull();
    expect(screen.queryByTestId("mini-chrome-time-remaining")).toBeNull();
  });

  it("clamps remaining at 0 when currentTime exceeds duration", () => {
    render(
      <MiniChrome {...baseProps} currentTime={1000} duration={600} />,
    );
    expect(screen.getByTestId("mini-chrome-time-remaining").textContent).toBe("-0:00");
  });
});

// ── Skip Intro / Credits / Next Episode pill (prexu-0ru) ───────────────────
describe("MiniChrome skip pill", () => {
  it("renders 'Skip Intro' when activeSegment.type === 'intro'", () => {
    render(
      <MiniChrome
        {...baseProps}
        activeSegment={{ type: "intro", endTime: 90 }}
        onSkipSegment={vi.fn()}
      />,
    );
    const pill = screen.getByTestId("mini-chrome-skip-pill");
    expect(pill.textContent).toBe("Skip Intro");
  });

  it("renders 'Skip Credits' when activeSegment.type === 'credits' AND hasNextItem=false", () => {
    render(
      <MiniChrome
        {...baseProps}
        activeSegment={{ type: "credits", endTime: 580 }}
        onSkipSegment={vi.fn()}
        hasNextItem={false}
      />,
    );
    expect(screen.getByTestId("mini-chrome-skip-pill").textContent).toBe(
      "Skip Credits",
    );
  });

  it("renders BOTH 'Skip Credits' (primary) and 'Next Episode' (secondary) when credits + hasNextItem=true", () => {
    render(
      <MiniChrome
        {...baseProps}
        activeSegment={{ type: "credits", endTime: 580 }}
        onSkipSegment={vi.fn()}
        hasNextItem={true}
        onNextEpisode={vi.fn()}
      />,
    );
    // Primary pill is still "Skip Credits" so users can watch post-credits scenes.
    expect(screen.getByTestId("mini-chrome-skip-pill").textContent).toBe("Skip Credits");
    // Secondary pill is "Next Episode".
    expect(screen.getByTestId("mini-chrome-skip-pill-next").textContent).toBe("Next Episode");
  });

  it("clicking 'Skip Intro' calls onSkipSegment and onActivity", () => {
    const onSkipSegment = vi.fn();
    const onActivity = vi.fn();
    render(
      <MiniChrome
        {...baseProps}
        activeSegment={{ type: "intro", endTime: 90 }}
        onSkipSegment={onSkipSegment}
        onActivity={onActivity}
      />,
    );
    fireEvent.click(screen.getByTestId("mini-chrome-skip-pill"));
    expect(onSkipSegment).toHaveBeenCalledTimes(1);
    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it("clicking the secondary 'Next Episode' pill calls onNextEpisode (not onSkipSegment)", () => {
    const onSkipSegment = vi.fn();
    const onNextEpisode = vi.fn();
    render(
      <MiniChrome
        {...baseProps}
        activeSegment={{ type: "credits", endTime: 580 }}
        onSkipSegment={onSkipSegment}
        hasNextItem={true}
        onNextEpisode={onNextEpisode}
      />,
    );
    fireEvent.click(screen.getByTestId("mini-chrome-skip-pill-next"));
    expect(onNextEpisode).toHaveBeenCalledTimes(1);
    expect(onSkipSegment).not.toHaveBeenCalled();
  });

  it("clicking the primary 'Skip Credits' pill calls onSkipSegment (not onNextEpisode)", () => {
    const onSkipSegment = vi.fn();
    const onNextEpisode = vi.fn();
    render(
      <MiniChrome
        {...baseProps}
        activeSegment={{ type: "credits", endTime: 580 }}
        onSkipSegment={onSkipSegment}
        hasNextItem={true}
        onNextEpisode={onNextEpisode}
      />,
    );
    fireEvent.click(screen.getByTestId("mini-chrome-skip-pill"));
    expect(onSkipSegment).toHaveBeenCalledTimes(1);
    expect(onNextEpisode).not.toHaveBeenCalled();
  });

  it("does NOT render the pill when activeSegment is null", () => {
    render(<MiniChrome {...baseProps} activeSegment={null} />);
    expect(screen.queryByTestId("mini-chrome-skip-pill")).toBeNull();
  });

  it("does NOT render the pill when onSkipSegment is absent (defensive)", () => {
    render(
      <MiniChrome
        {...baseProps}
        activeSegment={{ type: "intro", endTime: 90 }}
      />,
    );
    expect(screen.queryByTestId("mini-chrome-skip-pill")).toBeNull();
  });

  it("pill wrapper carries data-mini-no-drag so it doesn't start an anchor drag", () => {
    render(
      <MiniChrome
        {...baseProps}
        activeSegment={{ type: "intro", endTime: 90 }}
        onSkipSegment={vi.fn()}
      />,
    );
    expect(
      screen
        .getByTestId("mini-chrome-skip-pill-wrap")
        .getAttribute("data-mini-no-drag"),
    ).toBe("true");
  });

  it("pill respects visible=false (opacity 0 + pointer-events none)", () => {
    render(
      <MiniChrome
        {...baseProps}
        visible={false}
        activeSegment={{ type: "intro", endTime: 90 }}
        onSkipSegment={vi.fn()}
      />,
    );
    const wrap = screen.getByTestId("mini-chrome-skip-pill-wrap");
    expect(wrap.style.opacity).toBe("0");
    expect(wrap.style.pointerEvents).toBe("none");
  });
});
