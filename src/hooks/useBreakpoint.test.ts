import { renderHook, act } from "@testing-library/react";
import { useBreakpoint, isMobile, isTabletOrBelow, isDesktopOrAbove } from "./useBreakpoint";
import type { Breakpoint } from "./useBreakpoint";

// Helper to mock matchMedia for a specific breakpoint
function setupMatchMedia(breakpoint: Breakpoint) {
  const queries: Record<string, Breakpoint> = {
    "(max-width: 767px)": "mobile",
    "(min-width: 768px) and (max-width: 1024px)": "tablet",
    "(min-width: 1025px) and (max-width: 1440px)": "desktop",
    "(min-width: 1441px)": "large",
  };

  const listeners = new Map<string, Set<() => void>>();

  const mockMatchMedia = vi.fn().mockImplementation((query: string) => {
    if (!listeners.has(query)) listeners.set(query, new Set());
    const mql = {
      matches: queries[query] === breakpoint,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_: string, cb: () => void) => {
        listeners.get(query)!.add(cb);
      }),
      removeEventListener: vi.fn((_: string, cb: () => void) => {
        listeners.get(query)!.delete(cb);
      }),
      dispatchEvent: vi.fn(),
    };
    return mql;
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: mockMatchMedia,
  });

  // Return a function to simulate a breakpoint change
  return {
    mockMatchMedia,
    simulateChange(newBreakpoint: Breakpoint) {
      // Update matchMedia to return new breakpoint
      mockMatchMedia.mockImplementation((query: string) => {
        if (!listeners.has(query)) listeners.set(query, new Set());
        return {
          matches: queries[query] === newBreakpoint,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn((_: string, cb: () => void) => {
            listeners.get(query)!.add(cb);
          }),
          removeEventListener: vi.fn((_: string, cb: () => void) => {
            listeners.get(query)!.delete(cb);
          }),
          dispatchEvent: vi.fn(),
        };
      });

      // Fire all registered listeners
      for (const cbs of listeners.values()) {
        cbs.forEach((cb) => cb());
      }
    },
  };
}

describe("useBreakpoint", () => {
  it("returns 'desktop' by default (matchMedia stub returns false)", () => {
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("desktop");
  });

  it("returns 'mobile' when mobile query matches", () => {
    setupMatchMedia("mobile");
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("mobile");
  });

  it("returns 'tablet' when tablet query matches", () => {
    setupMatchMedia("tablet");
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("tablet");
  });

  it("returns 'large' when large query matches", () => {
    setupMatchMedia("large");
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("large");
  });

  it("updates when breakpoint changes", () => {
    const { simulateChange } = setupMatchMedia("desktop");
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("desktop");

    act(() => {
      simulateChange("mobile");
    });

    expect(result.current).toBe("mobile");
  });

  it("cleans up event listeners on unmount", () => {
    const { mockMatchMedia } = setupMatchMedia("desktop");
    const { unmount } = renderHook(() => useBreakpoint());

    unmount();

    // At least some matchMedia results should have removeEventListener called
    // (the ones from the useEffect, not from the initial getBreakpoint)
    const results = mockMatchMedia.mock.results;
    const removeCalls = results.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => r.value?.removeEventListener?.mock?.calls?.length > 0
    );
    expect(removeCalls.length).toBeGreaterThan(0);
  });
});

describe("isMobile", () => {
  it("returns true for mobile", () => {
    expect(isMobile("mobile")).toBe(true);
  });

  it("returns false for tablet", () => {
    expect(isMobile("tablet")).toBe(false);
  });

  it("returns false for desktop", () => {
    expect(isMobile("desktop")).toBe(false);
  });

  it("returns false for large", () => {
    expect(isMobile("large")).toBe(false);
  });
});

describe("isTabletOrBelow", () => {
  it("returns true for mobile", () => {
    expect(isTabletOrBelow("mobile")).toBe(true);
  });

  it("returns true for tablet", () => {
    expect(isTabletOrBelow("tablet")).toBe(true);
  });

  it("returns false for desktop", () => {
    expect(isTabletOrBelow("desktop")).toBe(false);
  });

  it("returns false for large", () => {
    expect(isTabletOrBelow("large")).toBe(false);
  });
});

describe("isDesktopOrAbove", () => {
  it("returns false for mobile", () => {
    expect(isDesktopOrAbove("mobile")).toBe(false);
  });

  it("returns false for tablet", () => {
    expect(isDesktopOrAbove("tablet")).toBe(false);
  });

  it("returns true for desktop", () => {
    expect(isDesktopOrAbove("desktop")).toBe(true);
  });

  it("returns true for large", () => {
    expect(isDesktopOrAbove("large")).toBe(true);
  });
});
