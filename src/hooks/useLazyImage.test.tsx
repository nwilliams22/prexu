import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { useLazyImage, _resetSharedObserversForTesting } from "./useLazyImage";

// ---------------------------------------------------------------------------
// IntersectionObserver stubs
//
// With the shared-observer refactor the module constructs one IO per rootMargin
// and routes entries by element. All stubs therefore need to:
//   - Accept a callback that takes IntersectionObserverEntry[]
//   - Provide a `target` element in each fired entry so the shared pool's
//     element-keyed dispatch can find the right consumer callback
// ---------------------------------------------------------------------------

/** IO class that fires isIntersecting=true for every observe() call. */
function makeImmediateIO() {
  return class ImmediateIO {
    private cb: (entries: IntersectionObserverEntry[]) => void;
    constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
      this.cb = cb;
    }
    observe(el: Element) {
      this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry]);
    }
    unobserve(_el: Element) {}
    disconnect() {}
  };
}

/** IO class that never fires. */
function makeNeverIO() {
  return class NeverIO {
    private cb: (entries: IntersectionObserverEntry[]) => void;
    constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
      this.cb = cb;
    }
    observe(_el: Element) {}
    unobserve(_el: Element) {}
    disconnect() {}
  };
}

/**
 * Returns a controllable IO class + a `trigger(el, isIntersecting)` function.
 * The caller supplies the element so target-keyed dispatch works.
 */
function makeControllableIO() {
  let storedCb: ((entries: IntersectionObserverEntry[]) => void) | null = null;
  const trigger = (el: Element, isIntersecting = true) => {
    storedCb?.([{ isIntersecting, target: el } as IntersectionObserverEntry]);
  };
  const IOClass = class ControlIO {
    constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
      storedCb = cb;
    }
    observe(_el: Element) {}
    unobserve(_el: Element) {}
    disconnect() {}
  };
  return { IOClass, trigger };
}

// Reset shared-observer pool AND DOM after each test so stubs don't bleed
// across suites. The module-level Map must be cleared before the global stub
// is restored (vi.unstubAllGlobals) because _resetSharedObserversForTesting
// calls observer.disconnect() — that should call the stub's disconnect, not
// the real API which may not be available in jsdom.
afterEach(() => {
  _resetSharedObserversForTesting();
  vi.unstubAllGlobals();
  cleanup();
});

// ---------------------------------------------------------------------------
// Component wrapper — gives containerRef a real DOM element to observe
// ---------------------------------------------------------------------------

function HookHost({ onResult }: { onResult: (r: ReturnType<typeof useLazyImage>) => void }) {
  const result = useLazyImage();
  onResult(result);
  return <div ref={result.containerRef} data-testid="container" />;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLazyImage", () => {
  describe("basic state transitions (shouldLoad stays false)", () => {
    it("starts with all flags false", () => {
      vi.stubGlobal("IntersectionObserver", makeNeverIO());
      const { result } = renderHook(() => useLazyImage());
      expect(result.current.shouldLoad).toBe(false);
      expect(result.current.isLoaded).toBe(false);
      expect(result.current.hasError).toBe(false);
      expect(result.current.placeholderLoaded).toBe(false);
    });

    it("onLoad sets isLoaded to true", () => {
      vi.stubGlobal("IntersectionObserver", makeNeverIO());
      const { result } = renderHook(() => useLazyImage());
      act(() => { result.current.onLoad(); });
      expect(result.current.isLoaded).toBe(true);
    });

    it("onError sets hasError to true", () => {
      vi.stubGlobal("IntersectionObserver", makeNeverIO());
      const { result } = renderHook(() => useLazyImage());
      act(() => { result.current.onError(); });
      expect(result.current.hasError).toBe(true);
    });

    it("onPlaceholderLoad sets placeholderLoaded to true", () => {
      vi.stubGlobal("IntersectionObserver", makeNeverIO());
      const { result } = renderHook(() => useLazyImage());
      act(() => { result.current.onPlaceholderLoad(); });
      expect(result.current.placeholderLoaded).toBe(true);
    });
  });

  describe("IntersectionObserver — shouldLoad transitions", () => {
    it("sets shouldLoad true when observer fires isIntersecting=true", () => {
      const { IOClass, trigger } = makeControllableIO();
      vi.stubGlobal("IntersectionObserver", IOClass);

      let captured: ReturnType<typeof useLazyImage> | null = null;
      const { rerender } = render(<HookHost onResult={(r) => { captured = r; }} />);
      expect(captured!.shouldLoad).toBe(false);

      const el = captured!.containerRef.current!;
      act(() => { trigger(el, true); });
      rerender(<HookHost onResult={(r) => { captured = r; }} />);

      expect(captured!.shouldLoad).toBe(true);
    });

    it("keeps shouldLoad false when observer reports isIntersecting=false", () => {
      const { IOClass, trigger } = makeControllableIO();
      vi.stubGlobal("IntersectionObserver", IOClass);

      let captured: ReturnType<typeof useLazyImage> | null = null;
      render(<HookHost onResult={(r) => { captured = r; }} />);

      const el = captured!.containerRef.current!;
      act(() => { trigger(el, false); });

      expect(captured!.shouldLoad).toBe(false);
    });
  });

  describe("cached-image race: img.complete fires before onLoad attaches", () => {
    /**
     * When shouldLoad becomes true and React renders <img src=...>, a cached
     * image fires its load event synchronously during element creation — before
     * the onLoad prop handler is attached. The every-render effect in the hook
     * detects this by checking imgRef.current.complete after each render.
     */

    it("sets isLoaded when imgRef.complete=true and naturalWidth>0", () => {
      vi.stubGlobal("IntersectionObserver", makeImmediateIO());

      let captured: ReturnType<typeof useLazyImage> | null = null;
      const { rerender } = render(<HookHost onResult={(r) => { captured = r; }} />);

      // Immediate IO fires on observe() so shouldLoad is already true after mount
      expect(captured!.shouldLoad).toBe(true);

      const fakeImg = { complete: true, naturalWidth: 200, error: null } as unknown as HTMLImageElement;

      act(() => {
        (captured!.imgRef as React.MutableRefObject<HTMLImageElement | null>).current = fakeImg;
        // Re-render causes the every-render effect to run with the ref set
        rerender(<HookHost onResult={(r) => { captured = r; }} />);
      });

      expect(captured!.isLoaded).toBe(true);
    });

    it("sets hasError when imgRef.complete=true but naturalWidth=0 (broken image)", () => {
      vi.stubGlobal("IntersectionObserver", makeImmediateIO());

      let captured: ReturnType<typeof useLazyImage> | null = null;
      const { rerender } = render(<HookHost onResult={(r) => { captured = r; }} />);
      expect(captured!.shouldLoad).toBe(true);

      const fakeImg = { complete: true, naturalWidth: 0, error: null } as unknown as HTMLImageElement;

      act(() => {
        (captured!.imgRef as React.MutableRefObject<HTMLImageElement | null>).current = fakeImg;
        rerender(<HookHost onResult={(r) => { captured = r; }} />);
      });

      expect(captured!.hasError).toBe(true);
      expect(captured!.isLoaded).toBe(false);
    });

    it("does not set isLoaded when imgRef.complete=false (still decoding)", () => {
      vi.stubGlobal("IntersectionObserver", makeImmediateIO());

      let captured: ReturnType<typeof useLazyImage> | null = null;
      const { rerender } = render(<HookHost onResult={(r) => { captured = r; }} />);
      expect(captured!.shouldLoad).toBe(true);

      const fakeImg = { complete: false, naturalWidth: 0, error: null } as unknown as HTMLImageElement;

      act(() => {
        (captured!.imgRef as React.MutableRefObject<HTMLImageElement | null>).current = fakeImg;
        rerender(<HookHost onResult={(r) => { captured = r; }} />);
      });

      expect(captured!.isLoaded).toBe(false);
      expect(captured!.hasError).toBe(false);
    });

    it("does not set isLoaded when shouldLoad is still false (element not in viewport)", () => {
      vi.stubGlobal("IntersectionObserver", makeNeverIO());

      let captured: ReturnType<typeof useLazyImage> | null = null;
      const { rerender } = render(<HookHost onResult={(r) => { captured = r; }} />);
      expect(captured!.shouldLoad).toBe(false);

      const fakeImg = { complete: true, naturalWidth: 200, error: null } as unknown as HTMLImageElement;

      act(() => {
        (captured!.imgRef as React.MutableRefObject<HTMLImageElement | null>).current = fakeImg;
        rerender(<HookHost onResult={(r) => { captured = r; }} />);
      });

      expect(captured!.isLoaded).toBe(false);
    });
  });

  describe("imgRef", () => {
    it("is exposed and initialises to null", () => {
      vi.stubGlobal("IntersectionObserver", makeNeverIO());
      const { result } = renderHook(() => useLazyImage());
      expect(result.current.imgRef).toBeDefined();
      expect(result.current.imgRef.current).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Shared-observer specific tests
  // ---------------------------------------------------------------------------

  describe("shared IntersectionObserver pool", () => {
    it("reuses the same IO instance for two hooks with the same rootMargin", () => {
      const constructorSpy = vi.fn();
      const IOClass = class SpyIO {
        private cb: (entries: IntersectionObserverEntry[]) => void;
        constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
          constructorSpy();
          this.cb = cb;
        }
        observe(_el: Element) {}
        unobserve(_el: Element) {}
        disconnect() {}
      };
      vi.stubGlobal("IntersectionObserver", IOClass);

      let r1: ReturnType<typeof useLazyImage> | null = null;
      let r2: ReturnType<typeof useLazyImage> | null = null;
      function Host1() {
        const res = useLazyImage("200px");
        r1 = res;
        return <div ref={res.containerRef} />;
      }
      function Host2() {
        const res = useLazyImage("200px");
        r2 = res;
        return <div ref={res.containerRef} />;
      }

      render(
        <>
          <Host1 />
          <Host2 />
        </>,
      );

      // Both hooks share the same rootMargin — only ONE IO should be constructed
      expect(constructorSpy).toHaveBeenCalledTimes(1);
      // Both containerRefs are populated
      expect(r1!.containerRef.current).not.toBeNull();
      expect(r2!.containerRef.current).not.toBeNull();
    });

    it("creates separate IO instances for different rootMargins", () => {
      const constructorSpy = vi.fn();
      const IOClass = class SpyIO {
        private cb: (entries: IntersectionObserverEntry[]) => void;
        constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
          constructorSpy();
          this.cb = cb;
        }
        observe(_el: Element) {}
        unobserve(_el: Element) {}
        disconnect() {}
      };
      vi.stubGlobal("IntersectionObserver", IOClass);

      function HostA() {
        const res = useLazyImage("100px");
        return <div ref={res.containerRef} />;
      }
      function HostB() {
        const res = useLazyImage("400px");
        return <div ref={res.containerRef} />;
      }

      render(
        <>
          <HostA />
          <HostB />
        </>,
      );

      // Different rootMargins → two separate IO instances
      expect(constructorSpy).toHaveBeenCalledTimes(2);
    });

    it("unobserves the element on unmount (does not leak callbacks)", () => {
      const unobserveSpy = vi.fn();
      const IOClass = class CleanupIO {
        private cb: (entries: IntersectionObserverEntry[]) => void;
        constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
          this.cb = cb;
        }
        observe(_el: Element) {}
        unobserve(el: Element) { unobserveSpy(el); }
        disconnect() {}
      };
      vi.stubGlobal("IntersectionObserver", IOClass);

      let captured: ReturnType<typeof useLazyImage> | null = null;
      const { unmount } = render(
        <HookHost onResult={(r) => { captured = r; }} />,
      );

      const el = captured!.containerRef.current!;
      expect(el).not.toBeNull();

      unmount();

      // unobserve should have been called with the element
      expect(unobserveSpy).toHaveBeenCalledWith(el);
    });

    it("fires the per-element callback and unobserves when intersection triggers", () => {
      const unobserveSpy = vi.fn();
      let storedCb: ((entries: IntersectionObserverEntry[]) => void) | null = null;
      const IOClass = class TriggerIO {
        constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
          storedCb = cb;
        }
        observe(_el: Element) {}
        unobserve(el: Element) { unobserveSpy(el); }
        disconnect() {}
      };
      vi.stubGlobal("IntersectionObserver", IOClass);

      let captured: ReturnType<typeof useLazyImage> | null = null;
      const { rerender } = render(
        <HookHost onResult={(r) => { captured = r; }} />,
      );

      const el = captured!.containerRef.current!;
      expect(captured!.shouldLoad).toBe(false);

      // Simulate intersection
      act(() => {
        storedCb!([{ isIntersecting: true, target: el } as IntersectionObserverEntry]);
      });
      rerender(<HookHost onResult={(r) => { captured = r; }} />);

      // shouldLoad must flip
      expect(captured!.shouldLoad).toBe(true);
      // The element must be unobserved after first intersection (once-and-done)
      expect(unobserveSpy).toHaveBeenCalledWith(el);
    });

    it("does not fire callback for a different element's intersection entry", () => {
      let storedCb: ((entries: IntersectionObserverEntry[]) => void) | null = null;
      const IOClass = class MultiIO {
        constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
          storedCb = cb;
        }
        observe(_el: Element) {}
        unobserve(_el: Element) {}
        disconnect() {}
      };
      vi.stubGlobal("IntersectionObserver", IOClass);

      let captured: ReturnType<typeof useLazyImage> | null = null;
      render(<HookHost onResult={(r) => { captured = r; }} />);

      // Fire an entry for a completely different element (not the one we observed)
      const foreignEl = document.createElement("div");
      act(() => {
        storedCb!([{ isIntersecting: true, target: foreignEl } as IntersectionObserverEntry]);
      });

      // shouldLoad must remain false — the callback was for a foreign element
      expect(captured!.shouldLoad).toBe(false);
    });
  });
});
