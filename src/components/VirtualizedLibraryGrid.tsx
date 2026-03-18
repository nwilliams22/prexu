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
 */

import { useRef, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useBreakpoint } from "../hooks/useBreakpoint";
import type { Breakpoint } from "../hooks/useBreakpoint";

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
}: VirtualizedLibraryGridProps<T>) {
  const bp = useBreakpoint();
  const minWidth = GRID_MIN_WIDTH_PX[bp];
  const parentRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);

  // Recalculate columns on resize
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth;
      setCols(Math.max(1, Math.floor((w + GAP_X) / (minWidth + GAP_X))));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [minWidth]);

  // For small item counts, use a simple CSS grid (no virtualization overhead)
  if (items.length < virtualizeThreshold) {
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
            <div key={getKey(item, i)}>{renderItem(item, i)}</div>
          ))}
          {footer}
        </div>
      </div>
    );
  }

  return (
    <VirtualizedGridInner
      items={items}
      renderItem={renderItem}
      getKey={getKey}
      estimateHeight={estimateHeight}
      parentRef={parentRef}
      cols={cols}
      minWidth={minWidth}
      expandedKey={expandedKey}
      renderExpansion={renderExpansion}
      header={header}
      footer={footer}
    />
  );
}

/** Inner virtualized component — extracted to avoid hook rules issues with early returns */
function VirtualizedGridInner<T>({
  items,
  renderItem,
  getKey,
  estimateHeight,
  parentRef,
  cols,
  minWidth,
  expandedKey,
  renderExpansion,
  header,
  footer,
}: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  estimateHeight: number;
  parentRef: React.RefObject<HTMLDivElement | null>;
  cols: number;
  minWidth: number;
  expandedKey?: string | null;
  renderExpansion?: (item: T) => ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  // Build the row model: group items into rows, inserting expansion rows as needed
  const rows = useMemo(() => {
    const result: VirtualRow<T>[] = [];
    for (let i = 0; i < items.length; i += cols) {
      const rowItems = items.slice(i, i + cols);
      result.push({ type: "cards", items: rowItems, startIndex: i });

      // Check if any item in this row is the expanded one
      if (expandedKey && renderExpansion) {
        const expandedItem = rowItems.find((item, idx) => getKey(item, i + idx) === expandedKey);
        if (expandedItem) {
          result.push({ type: "expansion", item: expandedItem });
        }
      }
    }
    return result;
  }, [items, cols, expandedKey, renderExpansion, getKey]);

  const getScrollElement = useCallback(() => {
    // Walk up to find the scrollable ancestor
    let el = parentRef.current?.parentElement;
    while (el) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") return el;
      el = el.parentElement;
    }
    return document.documentElement;
  }, [parentRef]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement,
    estimateSize: (index) => {
      const row = rows[index];
      if (row.type === "expansion") return 300; // expansion panel estimated height
      return estimateHeight + GAP_Y;
    },
    overscan: 3,
  });

  return (
    <div ref={parentRef}>
      {header && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
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
                gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
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
            gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
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
