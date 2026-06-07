import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import PopoutDragStrip from "./PopoutDragStrip";

describe("PopoutDragStrip", () => {
  it("carries the Tauri drag-region attribute so the borderless window is movable", () => {
    const { getByTestId } = render(<PopoutDragStrip visible />);
    const strip = getByTestId("popout-drag-strip");
    // data-tauri-drag-region is what Tauri's built-in handler keys off to call
    // window.startDragging — without it the frameless popout can't be dragged.
    expect(strip.hasAttribute("data-tauri-drag-region")).toBe(true);
  });

  it("is visible and interactive when revealed", () => {
    const { getByTestId } = render(<PopoutDragStrip visible />);
    const strip = getByTestId("popout-drag-strip");
    expect(strip.style.opacity).toBe("1");
    expect(strip.style.pointerEvents).toBe("auto");
  });

  it("is hidden and click-through when controls auto-hide", () => {
    const { getByTestId } = render(<PopoutDragStrip visible={false} />);
    const strip = getByTestId("popout-drag-strip");
    // Fully transparent (clean mini-player look) and must not block the
    // play/pause click target underneath while hidden.
    expect(strip.style.opacity).toBe("0");
    expect(strip.style.pointerEvents).toBe("none");
  });

  it("suppresses the default text-selection on primary mousedown", () => {
    const removeAllRanges = vi.fn();
    vi.spyOn(window, "getSelection").mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);

    const { getByTestId } = render(<PopoutDragStrip visible />);
    const strip = getByTestId("popout-drag-strip");
    // preventDefault on mousedown is what stops the WebView starting a
    // selection the OS drag-loop would then leave stuck (Image #2 regression).
    const prevented = !fireEvent.mouseDown(strip, { button: 0 });
    expect(prevented).toBe(true);
    expect(removeAllRanges).toHaveBeenCalled();
  });
});
