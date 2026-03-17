import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnnounce } from "./useAnnounce";

describe("useAnnounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.getElementById("a11y-live-region")?.remove();
  });

  it("creates a live region element in the document", () => {
    renderHook(() => useAnnounce());

    const region = document.getElementById("a11y-live-region");
    expect(region).not.toBeNull();
    expect(region?.tagName).toBe("DIV");
    expect(document.body.contains(region)).toBe(true);
  });

  it("announces a message after 50ms delay", () => {
    const { result } = renderHook(() => useAnnounce());

    act(() => {
      result.current("Hello world");
    });

    const region = document.getElementById("a11y-live-region")!;
    // Before the delay, text should be empty (cleared)
    expect(region.textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(region.textContent).toBe("Hello world");
  });

  it("defaults to polite priority", () => {
    const { result } = renderHook(() => useAnnounce());

    act(() => {
      result.current("test message");
    });

    const region = document.getElementById("a11y-live-region")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
  });

  it("supports assertive priority", () => {
    const { result } = renderHook(() => useAnnounce());

    act(() => {
      result.current("urgent message", "assertive");
    });

    const region = document.getElementById("a11y-live-region")!;
    expect(region.getAttribute("aria-live")).toBe("assertive");
  });

  it("clears text before setting new message for consecutive announces", () => {
    const { result } = renderHook(() => useAnnounce());

    act(() => {
      result.current("first message");
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    const region = document.getElementById("a11y-live-region")!;
    expect(region.textContent).toBe("first message");

    // Send the same message again
    act(() => {
      result.current("first message");
    });

    // Text should be cleared immediately before the 50ms delay
    expect(region.textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(50);
    });

    // After delay, message is set again
    expect(region.textContent).toBe("first message");
  });
});
