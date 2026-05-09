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
 */

import {
  useRef,
  useState,
  useCallback,
  useMemo,
  useLayoutEffect,
  useImperativeHandle,
  type ReactNode,
  type Ref,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useBreakpoint } from "../hooks/useBreakpoint";
import type { Breakpoint } from "../hooks/useBreakpoint";

export interface LibraryGridHandle {
  /** Smoothly scroll the grid to the item at the given index. */
  scrollToIndex: (index: number) => void;
}

interface VirtualizedLibraryGridProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  /** Key extractor for stable row identity */
  getKey: (item: T, index: number) => string;
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
  | { type: "cards"; items: T[]; startIndex: number }
  | { type: "expansion"; item: T };

function VirtualizedLibraryGrid<T>({
  items,
  renderItem,
  getKey,
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
  const virtualize = items.length >= virtualizeThreshold;

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
  // the hook order stays stable when items.length crosses the threshold.
  const rows = useMemo(() => {
    if (!virtualize) return [] as VirtualRow<T>[];
    const result: VirtualRow<T>[] = [];
    for (let i = 0; i < items.length; i += cols) {
      const rowItems = items.slice(i, i + cols);
      result.push({ type: "cards", items: rowItems, startIndex: i });
      if (expandedKey && renderExpansion) {
        const expandedItem = rowItems.find(
          (item, idx) => getKey(item, i + idx) === expandedKey,
        );
        if (expandedItem) {
          result.push({ type: "expansion", item: expandedItem });
        }
      }
    }
    return result;
  }, [virtualize, items, cols, expandedKey, renderExpansion, getKey]);

  const getScrollElement = useCallback(() => {
    let el = parentRef.current?.parentElement;
    while (el) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") return el;
      el = el.parentElement;
    }
    return document.documentElement;
  }, []);

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

  useImperativeHandle(
    ref,
    (): LibraryGridHandle => ({
      scrollToIndex: (index: number) => {
        if (index < 0) return;
        if (virtualize) {
          const rowIndex = Math.floor(index / Math.max(1, cols));
          // First pass uses estimated row heights for any unmeasured rows
          // between the current scroll position and the target. For an
          // alphabet jump that may cover hundreds of unmeasured rows, even a
          // small per-row estimate error compounds (e.g. 10 px × 200 rows =
          // 2000 px short). Once the target window renders, those rows get
          // measured by the virtualizer's measureElement callback; we
          // re-issue the scroll on the next frame so the corrected offset
          // is applied. A second RAF tick guards against multi-row libraries
          // where the second pass still has unmeasured neighbours.
          // `align: "start"` puts the target row at the TOP of the viewport
          // (behaviour the user expects for an alphabet jump). `behavior:
          // "auto"` (instant) avoids smooth-scroll animation latency that
          // would otherwise mask the second-pass correction.
          const v = virtualizerRef.current;
          v.scrollToIndex(rowIndex, { align: "start", behavior: "auto" });
          requestAnimationFrame(() => {
            virtualizerRef.current.scrollToIndex(rowIndex, {
              align: "start",
              behavior: "auto",
            });
            requestAnimationFrame(() => {
              virtualizerRef.current.scrollToIndex(rowIndex, {
                align: "start",
                behavior: "auto",
              });
            });
          });
          return;
        }
        const target = parentRef.current?.querySelector<HTMLElement>(
          `[data-grid-index="${index}"]`,
        );
        target?.scrollIntoView({ behavior: "auto", block: "start" });
      },
    }),
    [virtualize, cols],
  );

  // For small item counts, use a simple CSS grid (no virtualization overhead)
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
          {items.map((item, i) => (
            <div key={getKey(item, i)} data-grid-index={i}>
              {renderItem(item, i)}
            </div>
          ))}
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
            marginBottom: items.length > 0 ? `${GAP_Y}px` : 0,
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
              {row.items.map((item, colIndex) => (
                <div key={getKey(item, row.startIndex + colIndex)}>
                  {renderItem(item, row.startIndex + colIndex)}
                </div>
              ))}
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
            marginTop: items.length > 0 ? 0 : undefined,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

export default VirtualizedLibraryGrid;
