import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragGesture } from "./useDragGesture";

vi.mock("../../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

/** Fire a MouseEvent on the given target (or window). */
function fire(
  target: EventTarget,
  type: string,
  init: MouseEventInit = {},
): MouseEvent {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

/** Simulate a React.MouseEvent-shaped mousedown on the element returned by the
 *  hook's onMouseDown, using the underlying DOM MouseEvent. */
function reactMouseDown(
  onMouseDown: (e: React.MouseEvent) => void,
  init: MouseEventInit = {},
): MouseEvent {
  const ev = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  }) as unknown as React.MouseEvent;
  act(() => {
    onMouseDown(ev);
  });
  return ev as unknown as MouseEvent;
}

beforeEach(() => {
  // Reset document styles between tests.
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
});

afterEach(() => {
  // Belt-and-suspenders: remove any stray window listeners.
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
});

describe("useDragGesture", () => {
  // ── 1. Sub-threshold mouseup → only onCancel fires ─────────────────────────
  it("sub-threshold mouseup: onCancel fires; onMove and onCommit do NOT fire", () => {
    const onMove = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const onDragStart = vi.fn();

    const { result } = renderHook(() =>
      useDragGesture({
        getStart: () => ({ x: 0 }),
        threshold: 10,
        onMove,
        onCommit,
        onCancel,
        onDragStart,
      }),
    );

    // mousedown
    reactMouseDown(result.current.onMouseDown, {
      clientX: 100,
      clientY: 100,
    });

    // tiny move — well below 10px threshold
    act(() => {
      fire(window, "mousemove", { clientX: 102, clientY: 101 });
    });

    // mouseup without crossing threshold
    act(() => {
      fire(window, "mouseup", { clientX: 102, clientY: 101 });
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();
  });

  // ── 2. Threshold-crossing: onDragStart once, then onMove per move ──────────
  it("onDragStart fires exactly once when threshold is crossed; onMove fires for each subsequent move", () => {
    const onMove = vi.fn();
    const onDragStart = vi.fn();

    const { result } = renderHook(() =>
      useDragGesture({
        getStart: () => ({ x: 0 }),
        threshold: 4,
        onMove,
        onDragStart,
      }),
    );

    reactMouseDown(result.current.onMouseDown, { clientX: 0, clientY: 0 });

    // First move that crosses threshold
    act(() => {
      fire(window, "mousemove", { clientX: 10, clientY: 0 }); // dx=10 ≥ 4
    });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledTimes(1);

    // Additional moves — onDragStart must NOT fire again
    act(() => {
      fire(window, "mousemove", { clientX: 20, clientY: 0 });
      fire(window, "mousemove", { clientX: 30, clientY: 0 });
    });

    expect(onDragStart).toHaveBeenCalledTimes(1); // still exactly 1
    expect(onMove).toHaveBeenCalledTimes(3);

    // Clean up
    act(() => {
      fire(window, "mouseup", { clientX: 30, clientY: 0 });
    });
  });

  // ── 3. mouseup after threshold → onCommit fires with final delta ──────────
  it("mouseup after threshold: onCommit fires with correct final delta", () => {
    const onCommit = vi.fn();

    const { result } = renderHook(() =>
      useDragGesture({
        getStart: () => ({ w: 360, h: 200 }),
        threshold: 4,
        onCommit,
      }),
    );

    reactMouseDown(result.current.onMouseDown, { clientX: 100, clientY: 100 });

    // Cross the threshold
    act(() => {
      fire(window, "mousemove", { clientX: 200, clientY: 150 }); // dx=100, dy=50
    });

    act(() => {
      fire(window, "mouseup", { clientX: 250, clientY: 180 }); // final dx=150, dy=80
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const info = onCommit.mock.calls[0][0];
    expect(info.dx).toBe(150);
    expect(info.dy).toBe(80);
    expect(info.clientX).toBe(250);
    expect(info.clientY).toBe(180);
    expect(info.startX).toBe(100);
    expect(info.startY).toBe(100);
    expect(info.start).toEqual({ w: 360, h: 200 });
  });

  // ── 4. Non-primary button → no listeners attached ─────────────────────────
  it("right-click (button !== 0) does not attach listeners or fire callbacks", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const onMove = vi.fn();
    const onCommit = vi.fn();

    const { result } = renderHook(() =>
      useDragGesture({
        getStart: () => ({}),
        threshold: 4,
        onMove,
        onCommit,
      }),
    );

    // Right-click mousedown
    const ev = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 100,
      clientY: 100,
    }) as unknown as React.MouseEvent;
    act(() => {
      result.current.onMouseDown(ev);
    });

    // Move and up
    act(() => {
      fire(window, "mousemove", { clientX: 200, clientY: 200 });
      fire(window, "mouseup", { clientX: 200, clientY: 200 });
    });

    // No window.addEventListener calls for mousemove/mouseup from this hook
    const gestureListeners = addSpy.mock.calls.filter(
      ([type]) => type === "mousemove" || type === "mouseup",
    );
    expect(gestureListeners).toHaveLength(0);
    expect(onMove).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();

    addSpy.mockRestore();
  });

  // ── 5. Unmount mid-gesture → window listeners removed ────────────────────
  it("unmount mid-gesture removes window listeners (no leak)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { result, unmount } = renderHook(() =>
      useDragGesture({
        getStart: () => ({}),
        threshold: 4,
      }),
    );

    // Start a drag
    reactMouseDown(result.current.onMouseDown, { clientX: 0, clientY: 0 });

    // Cross threshold so listeners are definitely attached
    act(() => {
      fire(window, "mousemove", { clientX: 10, clientY: 0 });
    });

    // Unmount while drag is in flight
    act(() => {
      unmount();
    });

    // Both listeners must have been removed
    const removed = removeSpy.mock.calls.map(([type]) => type);
    expect(removed).toContain("mousemove");
    expect(removed).toContain("mouseup");

    // Document styles must be restored
    expect(document.body.style.userSelect).toBe("");

    removeSpy.mockRestore();
  });
});
