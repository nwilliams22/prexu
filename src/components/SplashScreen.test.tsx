import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import SplashScreen from "./SplashScreen";

describe("SplashScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the Prexu title", () => {
    render(<SplashScreen ready={false} />);
    expect(screen.getByText("Prexu")).toBeInTheDocument();
  });

  it("renders a loading spinner", () => {
    const { container } = render(<SplashScreen ready={false} />);
    expect(container.querySelector(".loading-spinner")).toBeInTheDocument();
  });

  it("renders an svg logo", () => {
    const { container } = render(<SplashScreen ready={false} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("stays visible when not ready", () => {
    render(<SplashScreen ready={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("Prexu")).toBeInTheDocument();
  });

  it("starts fade out after min display time when ready", () => {
    const { container } = render(<SplashScreen ready={true} />);
    // Before min display time elapses, still visible with opacity 1
    expect(container.firstChild).not.toBeNull();

    // Advance past MIN_DISPLAY_MS (2000ms)
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    // After fade starts, opacity should be 0
    const outerDiv = container.firstChild as HTMLElement;
    if (outerDiv) {
      expect(outerDiv.style.opacity).toBe("0");
    }
  });

  it("becomes hidden after fade out completes", () => {
    render(<SplashScreen ready={true} />);
    // Advance past MIN_DISPLAY_MS + fade duration (2000 + 400 = 2400ms)
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByText("Prexu")).not.toBeInTheDocument();
  });

  it("returns null after hidden state", () => {
    const { container } = render(<SplashScreen ready={true} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.firstChild).toBeNull();
  });

  it("cleans up timers on unmount", () => {
    const { unmount } = render(<SplashScreen ready={true} />);
    // Should not throw when unmounted before timers fire
    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
  });
});
