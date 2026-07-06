import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PopoutExitButton from "./PopoutExitButton";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PopoutExitButton", () => {
  it("renders an accessible exit-pop-out button", () => {
    render(<PopoutExitButton visible onExit={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Exit pop-out" }),
    ).toBeTruthy();
  });

  it("clicking the button calls onExit", () => {
    const onExit = vi.fn();
    render(<PopoutExitButton visible onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: "Exit pop-out" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("is visible and interactive when revealed", () => {
    render(<PopoutExitButton visible onExit={vi.fn()} />);
    const button = screen.getByTestId("popout-exit-button");
    expect(button.style.opacity).toBe("1");
    expect(button.style.pointerEvents).toBe("auto");
  });

  it("is hidden and click-through when controls auto-hide", () => {
    render(<PopoutExitButton visible={false} onExit={vi.fn()} />);
    const button = screen.getByTestId("popout-exit-button");
    expect(button.style.opacity).toBe("0");
    expect(button.style.pointerEvents).toBe("none");
  });

  // prexu-f4o4 regression: the exit-popout control used to live only
  // inside ControlsBottomBar's right-hand button cluster, which overflows
  // at small popout widths (no wrap, no compaction) and pushes the
  // trailing buttons — including pop-out — off-screen. This button is an
  // absolutely-positioned 24x24 sibling of PopoutDragStrip that never
  // depends on the surrounding row's width, so it stays reachable even at
  // the 200x120 logical pop-out floor.
  it("renders and remains reachable at the 200x120 pop-out floor viewport", () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { value: 200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 120, configurable: true });

    try {
      const onExit = vi.fn();
      render(<PopoutExitButton visible onExit={onExit} />);
      const button = screen.getByRole("button", { name: "Exit pop-out" });
      expect(button).toBeTruthy();
      fireEvent.click(button);
      expect(onExit).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: originalHeight, configurable: true });
    }
  });

  it("carries no width/size props — its layout is independent of the popout window's dimensions", () => {
    // Structural guard: PopoutExitButtonProps only exposes visible + onExit.
    // If this ever grows a width-dependent prop, the "always reachable at
    // any size" guarantee this component exists for would be at risk.
    render(<PopoutExitButton visible onExit={vi.fn()} />);
    const button = screen.getByTestId("popout-exit-button");
    expect(button.style.width).toBe("24px");
    expect(button.style.height).toBe("24px");
  });
});
