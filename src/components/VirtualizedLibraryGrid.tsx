/**
 * Virtualized grid for large collections of items.
 * Uses @tanstack/react-virtual for efficient rendering,
 * only mounting items that are visible in the viewport.
 *
 * Supports optional expansion panels: when an item is "expanded",
 * a full-width row is inserted below the row containing that item.
 *
 * For small collections (< 100 items), falls back to
 * the standard CSS grid to keep things simple.
 *
 * Exposes an imperative `scrollToIndex(index)` API via the React 19
 * `ref` prop, so callers (e.g. AlphaJumpBar) can scroll to off-screen
 * items even when virtualization has unmounted them.
 *
 * ── Fixed geometry / sparse item support (prexu-6qi5.1) ──
 *
 * Row count (and therefore total scrollable height) is derived from
 * `itemCount` (defaults to `items.length`), NOT from how many entries in
 * `items` are actually populated. This is what lets a caller (e.g.
 * LibraryView) jump straight to the bottom of a 2000-item section
 * instantly — the virtualizer's geometry spans the whole section from the
 * first paint, independent of what's been fetched.
 *
 * `items` may be a sparse-by-index array (`items[i]` is `undefined` for a
 * not-yet-fetched position) — a fully-populated dense array (the shape
 * every other consumer already passes) is just a special case of the same
 * contract, so existing callers are unaffected. Unfetched slots render via
 * `renderPlaceholder` instead of `renderItem`.
 *
 * `onRangeChange` fires whenever the visible (+ overscan) item range
 * changes, letting a caller wire it to a range-driven fetch hook.
 */

import {
  useRef,
  useState,
  useCallback,
  useMemo,
  useLayoutEffect,
  useEffect,
  useImperativeHandle,
  type ReactNode,
  type Ref,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useBreakpoint } from "../hooks/useBreakpoint";
import type { Breakpoint } from "../hooks/useBreakpoint";
import { logger } from "../services/logger";

export interface LibraryGridHandle {
  /** Smoothly scroll the grid to the item at the given index. */
  scrollToIndex: (index: number) => void;
}

/**
 * Convergence controller for `scrollToIndex` long jumps (prexu-k2mv).
 *
 * A single `scrollToIndex` call isn't enough for a long jump: the
 * virtualizer computes the target offset from ESTIMATED heights for every
 * row between the current scroll position and the target that hasn't been
 * measured yet. On real WebKitGTK layout, rows mounted by the jump measure
 * via `measureElement` well after a fixed handful of animation frames — a
 * ~74-row jump can accumulate enough per-row estimate error that a
 * fixed-count re-issue (the old 3-pass approach) stops while the geometry is
 * still wrong, landing several rows above/below the intended spot in either
 * scroll direction.
 *
 * Instead of counting frames, this loop VERIFIES convergence: after each
 * (re-)issued `scrollToIndex`, it recomputes the target row's expected start
 * offset from the virtualizer's live measurements and compares it with the
 * scroll container's actual `scrollTop`. It keeps re-issuing until:
 *  - they match within `CONVERGENCE_EPSILON_PX` (converged), OR
 *  - the expected offset is clamped by the container's max scroll (the
 *    target is within the last viewport — clamping there is success, not
 *    failure; this is the "Y near the end of a 530-item section" case), OR
 *  - a frame budget expires, in which case it forces a final direct
 *    `scrollTo` to the best-known (already clamped) offset rather than
 *    leaving the viewport visibly wrong.
 *
 * Extracted as a free function (rather than inlined in the imperative
 * handle) so it can be unit-tested deterministically with injected frame
 * ticks — real rAF/layout timing on WebKitGTK can't be reproduced in jsdom.
 */
export interface ScrollConvergenceCallbacks {
  /** Recompute the target row's current expected start offset from the
   *  virtualizer's live measurements. Returns `undefined` if the
   *  virtualizer can't answer yet. */
  getExpectedStart: () => number | undefined;
  /** Read the scroll container's actual current `scrollTop`. */
  getScrollTop: () => number;
  /** Read the scroll container's max scrollable offset
   *  (`scrollHeight - clientHeight`). */
  getMaxScroll: () => number;
  /** Re-issue the virtualizer's `scrollToIndex` for the target row. */
  issueScroll: () => void;
  /** Force the scroll container directly to a computed, already-clamped
   *  offset. Used only when the frame budget expires. */
  scrollTo: (offset: number) => void;
}

/** ~2px — small enough to be visually exact, large enough to tolerate
 *  sub-pixel rounding between the virtualizer's math and the DOM. */
export const CONVERGENCE_EPSILON_PX = 2;
/** ~20 frames (~350ms at 60fps) before giving up on verification and
 *  forcing a final corrective scroll. */
export const CONVERGENCE_MAX_FRAMES = 20;

/**
 * Runs the convergence loop described above. Call once per `scrollToIndex`
 * jump, immediately after issuing the initial (synchronous) scroll. Returns
 * a `cancel` function — call it when a new jump arrives or the component
 * unmounts so competing loops never fight over scroll position.
 */
export function runScrollConvergence(
  callbacks: ScrollConvergenceCallbacks,
  requestFrame: (tick: () => void) => void = (cb) => {
    requestAnimationFrame(cb);
  },
): () => void {
  let cancelled = false;
  let frame = 0;

  const tick = () => {
    if (cancelled) return;
    frame++;

    const maxScroll = Math.max(0, callbacks.getMaxScroll());
    const scrollTop = callbacks.getScrollTop();
    const rawExpected = callbacks.getExpectedStart();
    const expected =
      rawExpected === undefined ? undefined : Math.max(0, Math.min(rawExpected, maxScroll));

    if (expected !== undefined) {
      const delta = expected - scrollTop;
      if (Math.abs(delta) <= CONVERGENCE_EPSILON_PX) {
        logger.debug("library", "scroll convergence settled", {
          frames: frame,
          delta,
          clampedAtMax: expected >= maxScroll - CONVERGENCE_EPSILON_PX,
        });
        return;
      }
    }

    if (frame >= CONVERGENCE_MAX_FRAMES) {
      const finalTarget = expected ?? scrollTop;
      logger.debug("library", "scroll convergence budget expired, forcing final offset", {
        frames: frame,
        finalTarget,
      });
      callbacks.scrollTo(finalTarget);
      return;
    }

    callbacks.issueScroll();
    requestFrame(tick);
  };

  requestFrame(tick);

  return () => {
    cancelled = true;
  };
}

/**
 * Walk up from `el` to find the nearest scrollable ancestor (overflow-y
 * auto/scroll), falling back to `document.documentElement` for whole-page
 * scrolling. Shared by every virtualizer in the app (grid or row/list mode)
 * so they all locate the same scroll container the same way.
 */
export function findScrollAncestor(el: HTMLElement | null): Element {
  let current = el?.parentElement ?? null;
  while (current) {
    const overflow = getComputedStyle(current).overflowY;
    if (overflow === "auto" || overflow === "scroll") return current;
    current = current.parentElement;
  }
  return document.documentElement;
}

interface VirtualizedLibraryGridProps<T> {
  /** Sparse-by-index item store: `items[i]` may be `undefined` for a
   *  not-yet-fetched position. A fully-populated `T[]` (every existing
   *  caller) is a valid special case of this same contract. */
  items: (T | undefined)[];
  renderItem: (item: T, index: number) => ReactNode;
  /** Key extractor for stable row identity */
  getKey: (item: T, index: number) => string;
  /**
   * Total number of logical items in the section (defaults to
   * `items.length`). Row count and total scrollable height are derived from
   * this, NOT from how much of `items` is actually populated — this is what
   * lets the grid render fixed, fetch-independent geometry.
   */
  itemCount?: number;
  /** Render function for an unfetched slot (defaults to rendering nothing —
   *  callers backing a sparse store should pass e.g. a `SkeletonCard`). */
  renderPlaceholder?: (index: number) => ReactNode;
  /**
   * Fires whenever the visible (+ small overscan) item index range changes —
   * on scroll, resize, or an imperative `scrollToIndex` jump. Wire this to a
   * range-driven fetch hook so pages are requested for whatever's about to
   * be seen rather than in strict append order.
   */
  onRangeChange?: (startIndex: number, endIndex: number) => void;
  /** Estimated item height in px (default: 340) */
  estimateHeight?: number;
  /** Minimum item count to enable virtualization (default: 100) */
  virtualizeThreshold?: number;
  /** The key of the currently expanded item (if any) */
  expandedKey?: string | null;
  /** Render function for the expansion panel */
  renderExpansion?: (item: T) => ReactNode;
  /** Content to prepend to the grid (rendered above items, e.g. skeletons) */
  header?: ReactNode;
  /** Content to append to the grid (rendered below items, e.g. loading skeletons) */
  footer?: ReactNode;
  /** React 19 ref-as-prop: receives the imperative scroll handle */
  ref?: Ref<LibraryGridHandle>;
}

const GRID_MIN_WIDTH_PX: Record<Breakpoint, number> = {
  mobile: 150,
  tablet: 170,
  desktop: 185,
  large: 215,
};

const GAP_X = 12; // 0.75rem
const GAP_Y = 20; // 1.25rem

type VirtualRow<T> =
  | { type: "cards"; items: (T | undefined)[]; startIndex: number }
  | { type: "expansion"; item: T };

function VirtualizedLibraryGrid<T>({
  items,
  renderItem,
  getKey,
  itemCount,
  renderPlaceholder,
  onRangeChange,
  estimateHeight = 340,
  virtualizeThreshold = 100,
  expandedKey,
  renderExpansion,
  header,
  footer,
  ref,
}: VirtualizedLibraryGridProps<T>) {
  const bp = useBreakpoint();
  const minWidth = GRID_MIN_WIDTH_PX[bp];
  const parentRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  const totalCount = itemCount ?? items.length;
  const virtualize = totalCount >= virtualizeThreshold;

  // Recalculate columns on resize — use useLayoutEffect so the first
  // measurement happens synchronously before paint, avoiding a flash
  // where items are grouped with the stale default column count.
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) {
        setCols(Math.max(1, Math.floor((w + GAP_X) / (minWidth + GAP_X))));
      }
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [minWidth]);

  // Build the row model for virtualized path; keep call unconditional so
  // the hook order stays stable when totalCount crosses the threshold.
  // Bounded by `totalCount` (the SECTION size), not `items.length` — a row
  // exists for every position in the section even if nothing has been
  // fetched there yet, so scrollToIndex and the virtualizer's total height
  // are never blocked on a fetch.
  const rows = useMemo(() => {
    if (!virtualize) return [] as VirtualRow<T>[];
    const result: VirtualRow<T>[] = [];
    for (let i = 0; i < totalCount; i += cols) {
      const end = Math.min(i + cols, totalCount);
      const rowItems: (T | undefined)[] = [];
      for (let idx = i; idx < end; idx++) rowItems.push(items[idx]);
      result.push({ type: "cards", items: rowItems, startIndex: i });
      if (expandedKey && renderExpansion) {
        const expandedItem = rowItems.find(
          (item, idx) => item !== undefined && getKey(item, i + idx) === expandedKey,
        );
        if (expandedItem) {
          result.push({ type: "expansion", item: expandedItem });
        }
      }
    }
    return result;
  }, [virtualize, items, cols, expandedKey, renderExpansion, getKey]);

  const getScrollElement = useCallback(
    () => findScrollAncestor(parentRef.current),
    [],
  );

  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement,
    estimateSize: (index) => {
      const row = rows[index];
      if (!row) return estimateHeight + GAP_Y;
      if (row.type === "expansion") return 300;
      return estimateHeight + GAP_Y;
    },
    overscan: 3,
  });

  // Stash the latest virtualizer in a ref so the imperative handle never
  // closes over a stale instance (the virtualizer object itself changes
  // identity on each render).
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  // Always read the latest onRangeChange without making the range-change
  // effect below depend on its identity (callers typically pass a fresh
  // closure each render).
  const onRangeChangeRef = useRef(onRangeChange);
  onRangeChangeRef.current = onRangeChange;

  // Cancel function for any in-flight scrollToIndex convergence loop (see
  // runScrollConvergence above). A new jump must supersede the previous
  // one's loop, and unmount must not leave a loop running against a
  // detached scroll container.
  const convergenceCancelRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      convergenceCancelRef.current?.();
    };
  }, []);

  const virtualItemsForRange = virtualize ? virtualizer.getVirtualItems() : [];
  const firstVisibleRow = virtualItemsForRange[0]?.index;
  const lastVisibleRow = virtualItemsForRange[virtualItemsForRange.length - 1]?.index;

  // Notify the caller of the visible (+ virtualizer overscan) item range
  // whenever it changes — this is what drives range-keyed fetching. Reading
  // primitive row indices (rather than the virtual-items array, which is a
  // new reference every render) keeps this effect from firing on unrelated
  // re-renders.
  useEffect(() => {
    if (!virtualize || firstVisibleRow === undefined || lastVisibleRow === undefined) return;
    const firstRow = rows[firstVisibleRow];
    const lastRow = rows[lastVisibleRow];
    const startIndex = firstRow?.type === "cards" ? firstRow.startIndex : firstVisibleRow * cols;
    const endIndex =
      lastRow?.type === "cards"
        ? Math.min(lastRow.startIndex + lastRow.items.length, totalCount)
        : Math.min((lastVisibleRow + 1) * cols, totalCount);
    logger.trace("library", "grid visible range changed", { startIndex, endIndex });
    onRangeChangeRef.current?.(startIndex, endIndex);
  }, [virtualize, firstVisibleRow, lastVisibleRow, rows, cols, totalCount]);

  // Non-virtualized (small collection) path renders everything at once, so
  // the whole section is "the visible range" — report it once so ensureRange
  // can fill in any unfetched slots.
  useEffect(() => {
    if (virtualize || totalCount === 0) return;
    onRangeChangeRef.current?.(0, totalCount);
  }, [virtualize, totalCount]);

  useImperativeHandle(
    ref,
    (): LibraryGridHandle => ({
      scrollToIndex: (index: number) => {
        if (index < 0) return;
        // A new jump (e.g. rapid alphabet-bar clicks) must supersede any
        // in-flight convergence loop from a previous jump — otherwise the
        // two would keep re-issuing scrollToIndex against each other's
        // targets and neither would ever land.
        convergenceCancelRef.current?.();
        convergenceCancelRef.current = null;

        if (virtualize) {
          const rowIndex = Math.floor(index / Math.max(1, cols));
          const v = virtualizerRef.current;
          // Initial pass uses estimated row heights for any unmeasured rows
          // between the current scroll position and the target — for an
          // alphabet jump that may cover hundreds of unmeasured rows, even a
          // small per-row estimate error compounds (e.g. 10px × 200 rows =
          // 2000px short). `align: "start"` puts the target row at the TOP
          // of the viewport (behaviour the user expects for an alphabet
          // jump). `behavior: "auto"` (instant) avoids smooth-scroll
          // animation latency that would otherwise mask the convergence
          // loop's per-frame correction.
          v.scrollToIndex(rowIndex, { align: "start", behavior: "auto" });
          logger.debug("library", "scrollToIndex jump issued", { index, rowIndex, cols });

          const scrollElement = getScrollElement();
          convergenceCancelRef.current = runScrollConvergence({
            getExpectedStart: () => {
              const offsetInfo = virtualizerRef.current.getOffsetForIndex(rowIndex, "start");
              return offsetInfo?.[0];
            },
            getScrollTop: () => scrollElement.scrollTop,
            getMaxScroll: () => scrollElement.scrollHeight - scrollElement.clientHeight,
            issueScroll: () => {
              virtualizerRef.current.scrollToIndex(rowIndex, {
                align: "start",
                behavior: "auto",
              });
            },
            scrollTo: (offset) => {
              scrollElement.scrollTop = offset;
            },
          });
          return;
        }
        const target = parentRef.current?.querySelector<HTMLElement>(
          `[data-grid-index="${index}"]`,
        );
        target?.scrollIntoView({ behavior: "auto", block: "start" });
      },
    }),
    [virtualize, cols, getScrollElement],
  );

  // For small item counts, use a simple CSS grid (no virtualization overhead).
  // Bounded by totalCount (not items.length) so an unfetched slot still gets
  // a grid cell — rendered via renderPlaceholder instead of renderItem.
  if (!virtualize) {
    return (
      <div ref={parentRef}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
            gap: `${GAP_Y}px ${GAP_X}px`,
          }}
        >
          {header}
          {Array.from({ length: totalCount }, (_, i) => {
            const item = items[i];
            return (
              <div key={item ? getKey(item, i) : `placeholder-${i}`} data-grid-index={i}>
                {item !== undefined ? renderItem(item, i) : renderPlaceholder?.(i) ?? null}
              </div>
            );
          })}
          {footer}
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef}>
      {header && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: `${GAP_Y}px ${GAP_X}px`,
            marginBottom: totalCount > 0 ? `${GAP_Y}px` : 0,
          }}
        >
          {header}
        </div>
      )}

      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;

          if (row.type === "expansion") {
            return (
              <div
                key={`expansion-${virtualRow.index}`}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {renderExpansion!(row.item)}
              </div>
            );
          }

          return (
            <div
              key={`row-${virtualRow.index}`}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: `0 ${GAP_X}px`,
                alignItems: "start",
                paddingBottom: `${GAP_Y}px`,
              }}
            >
              {row.items.map((item, colIndex) => {
                const index = row.startIndex + colIndex;
                return (
                  <div key={item !== undefined ? getKey(item, index) : `placeholder-${index}`}>
                    {item !== undefined ? renderItem(item, index) : renderPlaceholder?.(index) ?? null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {footer && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: `${GAP_Y}px ${GAP_X}px`,
            marginTop: totalCount > 0 ? 0 : undefined,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

export default VirtualizedLibraryGrid;
