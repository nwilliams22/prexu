import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { useScrollRestoration } from "./useScrollRestoration";

function wrapper(path: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [path] }, children);
}

/**
 * The hook's initial restore attempt runs inside `requestAnimationFrame`.
 * Real rAF in jsdom is timer-backed and not synchronously flushable within
 * `act()` — a manual, synchronously-flushable queue matches the pattern
 * already used for Dashboard/VirtualizedLibraryGrid's rAF-based staging.
 */
let rafQueue: FrameRequestCallback[] = [];
function flushRaf() {
  const queue = rafQueue;
  rafQueue = [];
  for (const cb of queue) cb(0);
}

describe("useScrollRestoration", () => {
  let main: HTMLElement;

  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = "";
    main = document.createElement("main");
    document.body.appendChild(main);

    rafQueue = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        rafQueue.push(cb);
        return rafQueue.length;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores the saved scroll position once the container is tall enough", () => {
    sessionStorage.setItem("prexu_scroll_/library/1", "500");
    Object.defineProperty(main, "scrollHeight", { value: 1000, configurable: true });

    renderHook(() => useScrollRestoration(), { wrapper: wrapper("/library/1") });

    act(() => flushRaf());

    expect(main.scrollTop).toBe(500);
  });

  it("calls onRestore with the restored offset the moment it lands (prexu-5f12)", () => {
    sessionStorage.setItem("prexu_scroll_/library/1", "500");
    Object.defineProperty(main, "scrollHeight", { value: 1000, configurable: true });

    const onRestore = vi.fn();
    renderHook(() => useScrollRestoration({ onRestore }), {
      wrapper: wrapper("/library/1"),
    });

    expect(onRestore).not.toHaveBeenCalled();

    act(() => flushRaf());

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith({ restoredTo: 500 });
  });

  it("does not call onRestore when there is nothing to restore (fresh section, no saved offset)", () => {
    Object.defineProperty(main, "scrollHeight", { value: 1000, configurable: true });

    const onRestore = vi.fn();
    renderHook(() => useScrollRestoration({ onRestore }), {
      wrapper: wrapper("/library/1"),
    });

    act(() => flushRaf());

    expect(onRestore).not.toHaveBeenCalled();
    expect(main.scrollTop).toBe(0);
  });

  it("does not call onRestore yet when the container isn't tall enough on the first attempt", () => {
    sessionStorage.setItem("prexu_scroll_/library/1", "500");
    // Not tall enough yet — matches a POP mount whose sparse store hasn't
    // populated (and therefore hasn't grown the virtualized grid) at the
    // moment of the first restore attempt.
    Object.defineProperty(main, "scrollHeight", { value: 100, configurable: true });

    const onRestore = vi.fn();
    renderHook(() => useScrollRestoration({ onRestore }), {
      wrapper: wrapper("/library/1"),
    });

    act(() => flushRaf());

    expect(onRestore).not.toHaveBeenCalled();
    expect(main.scrollTop).toBe(0);
  });

  it("works exactly as before when no options are passed (backward compatible)", () => {
    sessionStorage.setItem("prexu_scroll_/library/1", "500");
    Object.defineProperty(main, "scrollHeight", { value: 1000, configurable: true });

    expect(() => {
      renderHook(() => useScrollRestoration(), { wrapper: wrapper("/library/1") });
      act(() => flushRaf());
    }).not.toThrow();

    expect(main.scrollTop).toBe(500);
  });

  // W8 (prexu-pd1x.8): the SAVE half of the contract — the useLayoutEffect
  // cleanup persists the live scroll position (tracked on scroll events) to
  // sessionStorage under the pathname key when the hook unmounts.
  it("saves the current scroll position to sessionStorage on unmount, keyed by pathname", () => {
    Object.defineProperty(main, "scrollHeight", { value: 2000, configurable: true });

    const { unmount } = renderHook(() => useScrollRestoration(), {
      wrapper: wrapper("/library/1"),
    });
    act(() => flushRaf());

    // User scrolls; the hook tracks it in a ref via the scroll listener.
    main.scrollTop = 750;
    act(() => {
      main.dispatchEvent(new Event("scroll"));
    });

    unmount(); // useLayoutEffect cleanup runs before the DOM is torn down

    expect(sessionStorage.getItem("prexu_scroll_/library/1")).toBe("750");
  });

  it("saves and restores each pathname independently (no cross-key bleed)", () => {
    Object.defineProperty(main, "scrollHeight", { value: 2000, configurable: true });

    // Session A on /library/1 scrolls to 300, then leaves.
    const a = renderHook(() => useScrollRestoration(), { wrapper: wrapper("/library/1") });
    act(() => flushRaf());
    main.scrollTop = 300;
    act(() => main.dispatchEvent(new Event("scroll")));
    a.unmount();

    // Session B lands on /library/2, which has its own saved offset.
    sessionStorage.setItem("prexu_scroll_/library/2", "800");
    main.scrollTop = 0;
    renderHook(() => useScrollRestoration(), { wrapper: wrapper("/library/2") });
    act(() => flushRaf());

    expect(sessionStorage.getItem("prexu_scroll_/library/1")).toBe("300");
    expect(main.scrollTop).toBe(800); // /library/2's value, not /library/1's
  });

  // The restore waits for async content: the container is too short on the first
  // rAF, then API data lands (a DOM mutation grows scrollHeight) and the
  // MutationObserver drives the restore.
  it("restores once async content grows the container past the target (MutationObserver path)", async () => {
    sessionStorage.setItem("prexu_scroll_/library/1", "500");
    Object.defineProperty(main, "scrollHeight", { value: 100, configurable: true });

    const onRestore = vi.fn();
    renderHook(() => useScrollRestoration({ onRestore }), { wrapper: wrapper("/library/1") });

    act(() => flushRaf());
    expect(main.scrollTop).toBe(0); // too short — deferred to the observer

    // Async data renders: the container grows and the DOM mutates.
    Object.defineProperty(main, "scrollHeight", { value: 1000, configurable: true });
    await act(async () => {
      main.appendChild(document.createElement("div"));
    });

    await waitFor(() => expect(main.scrollTop).toBe(500));
    expect(onRestore).toHaveBeenCalledWith({ restoredTo: 500 });
  });
});
