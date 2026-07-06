import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { createRef } from "react";
import VirtualizedLibraryGrid, {
  runScrollConvergence,
  CONVERGENCE_EPSILON_PX,
  CONVERGENCE_MAX_FRAMES,
  type ScrollConvergenceCallbacks,
} from "./VirtualizedLibraryGrid";
import type { LibraryGridHandle } from "./VirtualizedLibraryGrid";

interface Item {
  id: string;
  title: string;
}

/**
 * `@tanstack/react-virtual`'s actual scroll/measurement behaviour is flaky to
 * simulate in jsdom (scrollTo is a no-op, so the library's own scroll-offset
 * tracking never updates). The row model (`rows`), the `count` passed into
 * `useVirtualizer`, and the row index math behind `scrollToIndex` are all
 * OUR code, though — so we mock the virtualizer itself (fully controlling
 * `getVirtualItems()`) and assert on how our component drives/reads it. This
 * keeps the tests deterministic while still exercising the real grid logic.
 */
let virtualItemsToReturn: Array<{ index: number; start: number }> = [];
const fakeScrollToIndex = vi.fn();
const fakeMeasureElement = vi.fn();
const fakeGetOffsetForIndex = vi.fn<(index: number, align?: string) => readonly [number, string] | undefined>();
const mockUseVirtualizer = vi.fn((config: { count: number }) => ({
  getTotalSize: () => config.count * 360,
  getVirtualItems: () => virtualItemsToReturn,
  scrollToIndex: fakeScrollToIndex,
  measureElement: fakeMeasureElement,
  getOffsetForIndex: fakeGetOffsetForIndex,
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (config: unknown) => mockUseVirtualizer(config as { count: number }),
}));

function makeItem(i: number): Item {
  return { id: String(i), title: `Item ${i}` };
}

const renderItem = (item: Item) => <div>{item.title}</div>;
const getKey = (item: Item) => item.id;

/**
 * `scrollToIndex`'s imperative handle re-issues itself via two nested
 * `requestAnimationFrame` calls (see VirtualizedLibraryGrid.tsx). Real rAF
 * timing in jsdom is a single global queue shared across tests — a test that
 * schedules frames without draining them leaks pending callbacks into
 * whichever test runs next. A tiny manual queue makes frame advancement
 * synchronous and test-scoped instead.
 */
let rafQueue: FrameRequestCallback[] = [];
function flushRaf() {
  const queue = rafQueue;
  rafQueue = [];
  for (const cb of queue) cb(0);
}

/**
 * File-scoped (not nested inside any one `describe`) so it runs before
 * EVERY test in this file, regardless of which block it lives in. Scoping
 * this to a single `describe`'s own `beforeEach` was itself a test-isolation
 * bug (prexu-k2mv): sibling `describe` blocks never got `rafQueue` cleared
 * or the shared virtualizer mocks reset, so a convergence-loop tick left
 * pending (unflushed) by an earlier test — or a `mockImplementation` primed
 * by one convergence test — leaked into whichever test ran next.
 * `vi.clearAllMocks()` alone does NOT strip a previously-set
 * `mockImplementation`/`mockReturnValue`, hence the explicit `mockReset()`s.
 */
beforeEach(() => {
  vi.clearAllMocks();
  fakeScrollToIndex.mockReset();
  fakeGetOffsetForIndex.mockReset();
  fakeGetOffsetForIndex.mockReturnValue(undefined);
  virtualItemsToReturn = [];
  rafQueue = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }),
  );
});

describe("VirtualizedLibraryGrid — fixed geometry / sparse items (prexu-6qi5.1)", () => {

  it("derives the virtualizer row count from itemCount, not items.length", () => {
    // Only index 0 is fetched, but the section has 1000 logical items.
    const items: (Item | undefined)[] = [makeItem(0)];

    render(
      <VirtualizedLibraryGrid
        items={items}
        itemCount={1000}
        renderItem={renderItem}
        getKey={getKey}
        virtualizeThreshold={100}
      />,
    );

    expect(mockUseVirtualizer).toHaveBeenCalled();
    const config = mockUseVirtualizer.mock.calls[0]![0];
    // cols defaults to 4 in jsdom (clientWidth is unmeasured, so the resize
    // measurement never fires) -> 1000 / 4 = 250 rows, independent of the
    // single fetched item.
    expect(config.count).toBe(250);
  });

  it("defaults itemCount to items.length for backward compatibility with existing dense-array callers", () => {
    const items: Item[] = Array.from({ length: 400 }, (_, i) => makeItem(i));

    render(<VirtualizedLibraryGrid items={items} renderItem={renderItem} getKey={getKey} />);

    const config = mockUseVirtualizer.mock.calls[0]![0];
    expect(config.count).toBe(Math.ceil(400 / 4));
  });

  it("does not virtualize when itemCount is below the threshold, even if items is sparse", () => {
    const items: (Item | undefined)[] = [makeItem(0)];

    render(
      <VirtualizedLibraryGrid
        items={items}
        itemCount={10}
        renderItem={renderItem}
        getKey={getKey}
        virtualizeThreshold={100}
      />,
    );

    const config = mockUseVirtualizer.mock.calls[0]![0];
    expect(config.count).toBe(0); // virtualize=false -> count is always 0
  });

  it("renders defined items and placeholders for sparse slots within the visible window", () => {
    virtualItemsToReturn = [
      { index: 0, start: 0 },
      { index: 1, start: 360 },
    ];
    const items: (Item | undefined)[] = [makeItem(0)]; // only index 0 is fetched

    render(
      <VirtualizedLibraryGrid
        items={items}
        itemCount={1000}
        renderItem={renderItem}
        getKey={getKey}
        renderPlaceholder={(i) => <div data-testid={`ph-${i}`}>skeleton</div>}
        virtualizeThreshold={100}
      />,
    );

    // Row 0 (indices 0-3): index 0 is fetched, 1-3 are placeholders.
    expect(screen.getByText("Item 0")).toBeInTheDocument();
    expect(screen.getByTestId("ph-1")).toBeInTheDocument();
    expect(screen.getByTestId("ph-3")).toBeInTheDocument();
    // Row 1 (indices 4-7): entirely unfetched.
    expect(screen.getByTestId("ph-4")).toBeInTheDocument();
    expect(screen.getByTestId("ph-7")).toBeInTheDocument();
  });

  it("renders nothing (not a crash) for a sparse slot when no renderPlaceholder is supplied", () => {
    virtualItemsToReturn = [{ index: 0, start: 0 }];
    const items: (Item | undefined)[] = [];

    const { container } = render(
      <VirtualizedLibraryGrid
        items={items}
        itemCount={4}
        renderItem={renderItem}
        getKey={getKey}
        virtualizeThreshold={1}
      />,
    );

    expect(container.querySelectorAll("[data-index]").length).toBeGreaterThan(0);
  });

  it("reports the visible item range (derived from the virtual rows) via onRangeChange", () => {
    // Rows 2-3 visible; cols defaults to 4 -> items [8, 16).
    virtualItemsToReturn = [
      { index: 2, start: 720 },
      { index: 3, start: 1080 },
    ];
    const onRangeChange = vi.fn();
    const items: (Item | undefined)[] = [];

    render(
      <VirtualizedLibraryGrid
        items={items}
        itemCount={1000}
        renderItem={renderItem}
        getKey={getKey}
        onRangeChange={onRangeChange}
        virtualizeThreshold={100}
      />,
    );

    expect(onRangeChange).toHaveBeenCalledWith(8, 16);
  });

  it("clamps the reported range to itemCount at the end of the section", () => {
    // 1000 items, 4 cols -> last row starts at index 996 (row 249).
    virtualItemsToReturn = [{ index: 249, start: 89640 }];
    const onRangeChange = vi.fn();

    render(
      <VirtualizedLibraryGrid
        items={[]}
        itemCount={1000}
        renderItem={renderItem}
        getKey={getKey}
        onRangeChange={onRangeChange}
        virtualizeThreshold={100}
      />,
    );

    expect(onRangeChange).toHaveBeenCalledWith(996, 1000);
  });

  it("reports the whole section once for the non-virtualized (small collection) fallback path", () => {
    const onRangeChange = vi.fn();

    render(
      <VirtualizedLibraryGrid
        items={[makeItem(0)]}
        itemCount={5}
        renderItem={renderItem}
        getKey={getKey}
        onRangeChange={onRangeChange}
        virtualizeThreshold={100}
      />,
    );

    expect(onRangeChange).toHaveBeenCalledWith(0, 5);
  });

  it("scrollToIndex computes the correct row for an index beyond items.length (unfetched item)", () => {
    const ref = createRef<LibraryGridHandle>();
    const items: (Item | undefined)[] = [makeItem(0)]; // only index 0 is loaded

    render(
      <VirtualizedLibraryGrid
        ref={ref}
        items={items}
        itemCount={1000}
        renderItem={renderItem}
        getKey={getKey}
        virtualizeThreshold={100}
      />,
    );

    act(() => {
      ref.current?.scrollToIndex(950); // far beyond items.length, well within itemCount
    });

    // cols defaults to 4 -> row = floor(950 / 4) = 237
    expect(fakeScrollToIndex).toHaveBeenCalledWith(237, expect.objectContaining({ align: "start" }));
  });

  // prexu-6qi5.2: the hardware repro (single click on a far-off letter
  // requiring ~20 clicks to land) was traced to the OLD clamped-count
  // virtualizer, fixed by prexu-6qi5.1's itemCount-driven geometry. These
  // tests verify the specific mechanics that regression depended on still
  // hold: index->row math for non-default column counts, and that a jump
  // far beyond the fetched range re-issues scrollToIndex across frames so
  // late-measured row heights correct the landing position.
  it("scrollToIndex divides by the ACTUAL measured column count, not a hardcoded default", () => {
    // Force a wide viewport so `measure()` computes cols > the jsdom default
    // of 4. desktop minWidth is 185px; (1600 + 12) / (185 + 12) = 8.17 -> 8.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      value: 1600,
    });

    const ref = createRef<LibraryGridHandle>();
    render(
      <VirtualizedLibraryGrid
        ref={ref}
        items={[]}
        itemCount={5000}
        renderItem={renderItem}
        getKey={getKey}
        virtualizeThreshold={100}
      />,
    );

    act(() => {
      // Reproduces the hardware log line: alpha jump to offset 2020.
      ref.current?.scrollToIndex(2020);
    });

    // cols = 8 -> row = floor(2020 / 8) = 252.
    expect(fakeScrollToIndex).toHaveBeenCalledWith(252, expect.objectContaining({ align: "start" }));

    // @ts-expect-error -- restoring jsdom's own (unconfigurable-by-default) descriptor
    delete HTMLElement.prototype.clientWidth;
  });

  it("scrollToIndex targets an unfetched slot in the non-virtualized fallback path too", () => {
    const scrollIntoViewSpy = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;

    const ref = createRef<LibraryGridHandle>();
    const items: (Item | undefined)[] = [makeItem(0)]; // items.length === 1

    render(
      <VirtualizedLibraryGrid
        ref={ref}
        items={items}
        itemCount={10} // below the virtualize threshold -> CSS-grid fallback
        renderItem={renderItem}
        getKey={getKey}
        renderPlaceholder={(i) => <div data-testid={`ph-${i}`}>skeleton</div>}
        virtualizeThreshold={100}
      />,
    );

    // Index 5 has never been fetched — still gets a grid cell (a placeholder).
    expect(screen.getByTestId("ph-5")).toBeInTheDocument();

    act(() => {
      ref.current?.scrollToIndex(5);
    });

    expect(scrollIntoViewSpy).toHaveBeenCalled();
  });
});

/**
 * A tiny deterministic frame scheduler for `runScrollConvergence` unit
 * tests — a bare array queue, distinct from the module-level `rafQueue`
 * used by the component-integration suite above, so these tests never
 * depend on the global `requestAnimationFrame` stub.
 */
function createFrameDriver() {
  let queue: Array<() => void> = [];
  return {
    requestFrame: (tick: () => void) => {
      queue.push(tick);
    },
    /** Run exactly the next queued tick (there is at most one pending at a
     *  time by construction — each tick either finalizes or schedules
     *  precisely one successor). */
    flush: () => {
      const next = queue.shift();
      next?.();
    },
    pendingCount: () => queue.length,
  };
}

describe("runScrollConvergence (prexu-k2mv)", () => {
  // Long jumps land inaccurately in both directions because the OLD fixed
  // 3-pass re-issue stops correcting before real WebKitGTK layout finishes
  // measuring the newly-mounted rows. These tests exercise the extracted
  // convergence controller directly (no DOM/component involved) so the
  // frame-by-frame logic is fully deterministic.

  it("(a) keeps correcting across more than 3 frames as the estimated offset drifts, then stops once it matches actual scroll position", () => {
    const driver = createFrameDriver();
    // Successive estimates as more rows get measured, stabilizing at 1450.
    const estimates = [1000, 1200, 1350, 1430, 1450, 1450, 1450, 1450, 1450, 1450];
    let idx = 0;
    let scrollTop = 500;
    const issueScroll = vi.fn(() => {
      scrollTop = estimates[Math.min(idx - 1, estimates.length - 1)];
    });
    const scrollTo = vi.fn();

    const callbacks: ScrollConvergenceCallbacks = {
      getExpectedStart: () => {
        const v = estimates[Math.min(idx, estimates.length - 1)];
        idx++;
        return v;
      },
      getScrollTop: () => scrollTop,
      getMaxScroll: () => 100_000,
      issueScroll,
      scrollTo,
    };

    runScrollConvergence(callbacks, driver.requestFrame);
    expect(driver.pendingCount()).toBe(1);

    // Frames 1-5 keep re-issuing as the estimate keeps changing -- more
    // than the old fixed count of 2 extra RAF re-issues.
    for (let i = 0; i < 5; i++) driver.flush();
    expect(issueScroll).toHaveBeenCalledTimes(5);
    expect(scrollTop).toBe(1450);

    // Frame 6: the estimate has stabilized and scrollTop already matches it
    // -- converged, no further re-issue or frame scheduled.
    driver.flush();
    expect(issueScroll).toHaveBeenCalledTimes(5);
    expect(driver.pendingCount()).toBe(0);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("(b) treats hitting the container's max scroll as convergence success, even though the raw target is beyond it", () => {
    const driver = createFrameDriver();
    const maxScroll = 5000;
    const rawTargets = [4800, 5100, 5300, 5300, 5300];
    let idx = 0;
    let scrollTop = 4000;
    const issueScroll = vi.fn(() => {
      const raw = rawTargets[Math.min(idx - 1, rawTargets.length - 1)];
      scrollTop = Math.min(raw, maxScroll);
    });
    const scrollTo = vi.fn();

    const callbacks: ScrollConvergenceCallbacks = {
      getExpectedStart: () => {
        const v = rawTargets[Math.min(idx, rawTargets.length - 1)];
        idx++;
        return v;
      },
      getScrollTop: () => scrollTop,
      getMaxScroll: () => maxScroll,
      issueScroll,
      scrollTo,
    };

    runScrollConvergence(callbacks, driver.requestFrame);
    driver.flush(); // expected clamp(4800)=4800 vs scrollTop 4000 -> re-issue
    driver.flush(); // expected clamp(5100)=5000 vs scrollTop 4800 -> re-issue
    driver.flush(); // expected clamp(5300)=5000 vs scrollTop 5000 -> converged

    expect(scrollTop).toBe(maxScroll);
    expect(driver.pendingCount()).toBe(0);
    // Converged via verification, not forced by budget expiry.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("(c) forces a final direct scrollTo when the frame budget expires without converging", () => {
    const driver = createFrameDriver();
    let n = 0;
    const issueScroll = vi.fn();
    const scrollTo = vi.fn();

    const callbacks: ScrollConvergenceCallbacks = {
      getExpectedStart: () => {
        n++;
        return 1000 + n; // always drifts further away -- pathological, never settles
      },
      getScrollTop: () => 0, // never actually catches up
      getMaxScroll: () => 1_000_000,
      issueScroll,
      scrollTo,
    };

    runScrollConvergence(callbacks, driver.requestFrame);
    for (let i = 0; i < CONVERGENCE_MAX_FRAMES; i++) driver.flush();

    // Frames 1..(MAX-1) re-issue; the MAXth frame gives up and forces a
    // direct scroll to the best-known offset instead of looping forever.
    expect(issueScroll).toHaveBeenCalledTimes(CONVERGENCE_MAX_FRAMES - 1);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(1000 + CONVERGENCE_MAX_FRAMES);
    expect(driver.pendingCount()).toBe(0);
  });

  it("(d) stops immediately once cancelled, even if a frame was already queued", () => {
    const driver = createFrameDriver();
    const getExpectedStart = vi.fn(() => 999_999); // always mismatched -- would loop forever
    const issueScroll = vi.fn();
    const scrollTo = vi.fn();

    const cancel = runScrollConvergence(
      {
        getExpectedStart,
        getScrollTop: () => 0,
        getMaxScroll: () => 10_000_000,
        issueScroll,
        scrollTo,
      },
      driver.requestFrame,
    );

    driver.flush(); // first check: mismatch -> re-issue -> schedules a successor
    expect(issueScroll).toHaveBeenCalledTimes(1);
    expect(driver.pendingCount()).toBe(1);

    cancel();
    driver.flush(); // the already-queued successor must no-op

    expect(getExpectedStart).toHaveBeenCalledTimes(1); // never checked again
    expect(issueScroll).toHaveBeenCalledTimes(1);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(driver.pendingCount()).toBe(0);
  });

  it("treats a delta at exactly the epsilon boundary as already converged", () => {
    const driver = createFrameDriver();
    const target = 5000;
    const scrollTop = target - CONVERGENCE_EPSILON_PX;
    const issueScroll = vi.fn();
    const scrollTo = vi.fn();

    runScrollConvergence(
      {
        getExpectedStart: () => target,
        getScrollTop: () => scrollTop,
        getMaxScroll: () => 1_000_000,
        issueScroll,
        scrollTo,
      },
      driver.requestFrame,
    );
    driver.flush();

    expect(issueScroll).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(driver.pendingCount()).toBe(0);
  });
});

describe("scrollToIndex convergence wiring (prexu-k2mv)", () => {
  // Component-level wiring for the convergence loop: real jsdom doesn't do
  // layout, so `scrollTop`/`scrollHeight`/`clientHeight` are stubbed on
  // HTMLElement.prototype (same technique as the `clientWidth` override
  // above) to make the scroll container's geometry controllable per test.
  let containerScrollTop = 0;
  let containerScrollHeight = 100_000;
  let containerClientHeight = 800;

  beforeEach(() => {
    containerScrollTop = 0;
    containerScrollHeight = 100_000;
    containerClientHeight = 800;
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get() {
        return containerScrollTop;
      },
      set(v: number) {
        containerScrollTop = v;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return containerScrollHeight;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return containerClientHeight;
      },
    });
  });

  afterEach(() => {
    // @ts-expect-error -- restoring jsdom's own (unconfigurable-by-default) descriptors
    delete HTMLElement.prototype.scrollTop;
    // @ts-expect-error -- restoring jsdom's own (unconfigurable-by-default) descriptors
    delete HTMLElement.prototype.scrollHeight;
    // @ts-expect-error -- restoring jsdom's own (unconfigurable-by-default) descriptors
    delete HTMLElement.prototype.clientHeight;
  });

  it("keeps re-issuing scrollToIndex across multiple frames as the estimated offset drifts, then stops once it converges", () => {
    const ref = createRef<LibraryGridHandle>();
    let currentEstimate = 4000;
    fakeGetOffsetForIndex.mockImplementation(() => [currentEstimate, "start"] as const);
    fakeScrollToIndex.mockImplementation(() => {
      containerScrollTop = currentEstimate;
    });

    render(
      <VirtualizedLibraryGrid
        ref={ref}
        items={[makeItem(0)]}
        itemCount={5000}
        renderItem={renderItem}
        getKey={getKey}
        virtualizeThreshold={100}
      />,
    );

    act(() => {
      ref.current?.scrollToIndex(2020); // cols defaults to 4 -> row 505
    });
    expect(containerScrollTop).toBe(4000);

    // New measurements land between frames, correcting the estimate.
    currentEstimate = 4500;
    act(() => {
      flushRaf();
    });
    expect(containerScrollTop).toBe(4500);

    currentEstimate = 4950;
    act(() => {
      flushRaf();
    });
    expect(containerScrollTop).toBe(4950);

    // Measurements settle -- the next check finds scrollTop already
    // matches and stops re-issuing (no more frames scheduled).
    act(() => {
      flushRaf();
    });
    expect(rafQueue.length).toBe(0);
    // 1 initial sync call + 2 corrective re-issues -- data-driven, not the
    // old fixed count of 3.
    expect(fakeScrollToIndex).toHaveBeenCalledTimes(3);
  });

  it("treats landing at max scroll as success without endless re-issuing (the Y-near-end-of-section clamp case)", () => {
    const ref = createRef<LibraryGridHandle>();
    containerScrollHeight = 5000;
    containerClientHeight = 800; // max scroll = 4200

    fakeGetOffsetForIndex.mockImplementation(() => [4800, "start"] as const); // raw target beyond max
    fakeScrollToIndex.mockImplementation(() => {
      containerScrollTop = Math.min(4800, containerScrollHeight - containerClientHeight);
    });

    render(
      <VirtualizedLibraryGrid
        ref={ref}
        items={[makeItem(0)]}
        itemCount={5000}
        renderItem={renderItem}
        getKey={getKey}
        virtualizeThreshold={100}
      />,
    );

    act(() => {
      ref.current?.scrollToIndex(2088);
    });
    expect(containerScrollTop).toBe(4200); // clamped immediately by the initial call

    act(() => {
      flushRaf();
    });

    // Converged on the very first check (clamped expected === clamped
    // actual) -- no further re-issues needed even though the raw target
    // (4800) was never reached.
    expect(rafQueue.length).toBe(0);
    expect(fakeScrollToIndex).toHaveBeenCalledTimes(1);
  });

  it("a new scrollToIndex jump cancels the previous convergence loop instead of fighting it", () => {
    const ref = createRef<LibraryGridHandle>();
    // Never converges on its own -- keeps any loop alive until cancelled or
    // superseded by a new jump.
    fakeGetOffsetForIndex.mockImplementation(() => [999_999, "start"] as const);
    fakeScrollToIndex.mockImplementation(() => {
      containerScrollTop = 0;
    });

    render(
      <VirtualizedLibraryGrid
        ref={ref}
        items={[makeItem(0)]}
        itemCount={5000}
        renderItem={renderItem}
        getKey={getKey}
        virtualizeThreshold={100}
      />,
    );

    act(() => {
      ref.current?.scrollToIndex(40); // row 10
    });
    expect(rafQueue.length).toBe(1); // first loop's next check is queued

    act(() => {
      ref.current?.scrollToIndex(4000); // row 1000 -- supersedes the first jump
    });

    act(() => {
      // Flushes BOTH the stale (now-cancelled) tick from the first jump and
      // the fresh tick scheduled by the second.
      flushRaf();
    });

    const rowsCalled = fakeScrollToIndex.mock.calls.map((call) => call[0]);
    const oldRowCalls = rowsCalled.filter((row) => row === 10).length;
    const newRowCalls = rowsCalled.filter((row) => row === 1000).length;

    // The cancelled loop only ever produced its one initial synchronous
    // call -- the stale queued frame must not re-issue for the old row.
    expect(oldRowCalls).toBe(1);
    // The new jump's own initial call (and possibly its re-issue) fired.
    expect(newRowCalls).toBeGreaterThanOrEqual(1);
  });

  it("forces a final scrollTop assignment if the frame budget expires without converging", () => {
    const ref = createRef<LibraryGridHandle>();
    fakeGetOffsetForIndex.mockImplementation(() => [50_000, "start"] as const); // always mismatched
    fakeScrollToIndex.mockImplementation(() => {
      containerScrollTop = 0; // pathological: the mocked virtualizer never actually moves it
    });

    render(
      <VirtualizedLibraryGrid
        ref={ref}
        items={[makeItem(0)]}
        itemCount={5000}
        renderItem={renderItem}
        getKey={getKey}
        virtualizeThreshold={100}
      />,
    );

    act(() => {
      ref.current?.scrollToIndex(2020);
    });

    act(() => {
      for (let i = 0; i < CONVERGENCE_MAX_FRAMES; i++) flushRaf();
    });

    // The convergence loop gave up and forced the container directly to the
    // best-known (clamped) offset rather than leaving the viewport wrong.
    expect(containerScrollTop).toBe(50_000);
    expect(rafQueue.length).toBe(0);
  });
});
