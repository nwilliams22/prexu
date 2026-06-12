import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { render } from "@testing-library/react";
import React from "react";
import { useLazyImage } from "./useLazyImage";

// ---------------------------------------------------------------------------
// IntersectionObserver stubs
// ---------------------------------------------------------------------------

/** Returns an IO class that fires isIntersecting=true inside observe(). */
function makeImmediateIO() {
  return class ImmediateIO {
    private cb: (entries: IntersectionObserverEntry[]) => void;
    constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
      this.cb = cb;
    }
    observe(el: Element) {
      this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry]);
    }
    disconnect() {}
    unobserve() {}
  };
}

/** Returns an IO class that never fires. */
function makeNeverIO() {
  return class NeverIO {
    constructor(_cb: unknown) {}
    observe() {}
    disconnect() {}
    unobserve() {}
  };
}

/** Returns a controllable IO class + a trigger function. */
function makeControllableIO() {
  let storedCb: ((entries: IntersectionObserverEntry[]) => void) | null = null;
  const trigger = (isIntersecting = true) => {
    storedCb?.([{ isIntersecting } as IntersectionObserverEntry]);
  };
  const IOClass = class ControlIO {
    constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
      storedCb = cb;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  return { IOClass, trigger };
}

// Restore the global after each test so stubs don't leak across suites
afterEach(() => {
  vi.unstubAllGlobals();
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

      act(() => { trigger(true); });
      rerender(<HookHost onResult={(r) => { captured = r; }} />);

      expect(captured!.shouldLoad).toBe(true);
    });

    it("keeps shouldLoad false when observer reports isIntersecting=false", () => {
      const { IOClass, trigger } = makeControllableIO();
      vi.stubGlobal("IntersectionObserver", IOClass);

      let captured: ReturnType<typeof useLazyImage> | null = null;
      render(<HookHost onResult={(r) => { captured = r; }} />);

      act(() => { trigger(false); });

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
});
