import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PopoutResizeZones from "./PopoutResizeZones";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PopoutResizeZones", () => {
  it("renders all four edge zones with the correct straight-resize cursors", () => {
    render(<PopoutResizeZones />);
    expect(screen.getByTestId("popout-resize-top").style.cursor).toBe("ns-resize");
    expect(screen.getByTestId("popout-resize-bottom").style.cursor).toBe("ns-resize");
    expect(screen.getByTestId("popout-resize-left").style.cursor).toBe("ew-resize");
    expect(screen.getByTestId("popout-resize-right").style.cursor).toBe("ew-resize");
  });

  it("renders all four corner zones with the correct diagonal-resize cursors", () => {
    render(<PopoutResizeZones />);
    // top-left / bottom-right corners resize along the nwse diagonal.
    expect(screen.getByTestId("popout-resize-top-left").style.cursor).toBe("nwse-resize");
    expect(screen.getByTestId("popout-resize-bottom-right").style.cursor).toBe("nwse-resize");
    // top-right / bottom-left corners resize along the nesw diagonal.
    expect(screen.getByTestId("popout-resize-top-right").style.cursor).toBe("nesw-resize");
    expect(screen.getByTestId("popout-resize-bottom-left").style.cursor).toBe("nesw-resize");
  });

  // prexu-f4o4: the resize itself already works below the DOM (compositor
  // hit-testing) — these zones only exist to show the cursor. They must
  // remain hit-testable (pointerEvents !== "none") for the browser to pick
  // up the `cursor` style on hover, but must not carry any click handler.
  it("all zones are hit-testable for cursor purposes but attach no click handler", () => {
    render(<PopoutResizeZones />);
    const testIds = [
      "popout-resize-top",
      "popout-resize-bottom",
      "popout-resize-left",
      "popout-resize-right",
      "popout-resize-top-left",
      "popout-resize-top-right",
      "popout-resize-bottom-left",
      "popout-resize-bottom-right",
    ];
    for (const id of testIds) {
      const el = screen.getByTestId(id);
      expect(el.style.pointerEvents).toBe("auto");
      expect(el.tagName).toBe("DIV");
      // A plain div with no onClick prop never receives React's synthetic
      // click dispatch — nothing to assert beyond "it's just a div".
      expect(el.onclick).toBeNull();
    }
  });

  it("renders decorative-only zones (aria-hidden) so they don't pollute the accessibility tree", () => {
    render(<PopoutResizeZones />);
    expect(screen.getByTestId("popout-resize-top").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("popout-resize-bottom-right").getAttribute("aria-hidden")).toBe("true");
  });
});
