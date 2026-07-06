import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { createRef } from "react";
import VirtualizedLibraryGrid from "./VirtualizedLibraryGrid";
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
const mockUseVirtualizer = vi.fn((config: { count: number }) => ({
  getTotalSize: () => config.count * 360,
  getVirtualItems: () => virtualItemsToReturn,
  scrollToIndex: fakeScrollToIndex,
  measureElement: fakeMeasureElement,
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (config: unknown) => mockUseVirtualizer(config as { count: number }),
}));

function makeItem(i: number): Item {
  return { id: String(i), title: `Item ${i}` };
}

const renderItem = (item: Item) => <div>{item.title}</div>;
const getKey = (item: Item) => item.id;

describe("VirtualizedLibraryGrid — fixed geometry / sparse items (prexu-6qi5.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    virtualItemsToReturn = [];
  });

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
