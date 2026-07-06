/**
 * Pure helpers for range-driven, sparse-store library pagination.
 *
 * These are deliberately free of React/fetch/state concerns so the
 * visible-range -> page-offset math and the sparse-store merge logic can be
 * unit tested in isolation from `usePaginatedLibrary`'s async orchestration.
 */

/** Fetch granularity for range-driven requests (aligned with the legacy PAGE_SIZE). */
export const RANGE_CHUNK_SIZE = 50;

/** Extra items fetched on each side of the visible range so a small scroll
 *  doesn't immediately need another round trip. */
export const RANGE_OVERSCAN = 50;

/**
 * Expand `[start, end)` by `overscan` on each side, clamped to `[0, total)`.
 */
export function expandRange(
  start: number,
  end: number,
  total: number,
  overscan: number,
): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(start, total) - overscan);
  const e = Math.max(s, Math.min(total, end + overscan));
  return { start: s, end: e };
}

/**
 * Chunk-aligned (multiples of `chunkSize`) offsets covering `[start, end)`,
 * clamped to `[0, total)`. Returned in ascending offset order.
 */
export function chunkOffsetsForRange(
  start: number,
  end: number,
  total: number,
  chunkSize: number,
): number[] {
  if (total <= 0 || end <= start || chunkSize <= 0) return [];
  const clampedStart = Math.max(0, start);
  const clampedEnd = Math.min(end, total);
  if (clampedEnd <= clampedStart) return [];

  const firstChunk = Math.floor(clampedStart / chunkSize) * chunkSize;
  const offsets: number[] = [];
  for (let o = firstChunk; o < clampedEnd; o += chunkSize) {
    offsets.push(o);
  }
  return offsets;
}

/**
 * True when every index in `[offset, offset + chunkSize)` (clamped to
 * `total`) already has a defined entry in `store`.
 */
export function isChunkLoaded<T>(
  store: ReadonlyArray<T | undefined>,
  offset: number,
  chunkSize: number,
  total: number,
): boolean {
  const end = Math.min(offset + chunkSize, total);
  for (let i = offset; i < end; i++) {
    if (store[i] === undefined) return false;
  }
  return true;
}

/**
 * Immutably merge a fetched chunk into a sparse-by-index store.
 *
 * The returned array is always dense up to `total` (every slot from 0 to
 * `total - 1` holds either a real item or an explicit `undefined`) — never a
 * JS "hole". Holes are silently skipped by `Array.prototype.filter/map/
 * forEach`, which would corrupt index alignment between the store and the
 * section's true positions; explicit `undefined` values are visited like any
 * other element and keep every consumer's indexing honest.
 */
export function mergeChunk<T>(
  store: ReadonlyArray<T | undefined>,
  offset: number,
  chunkItems: readonly T[],
  total: number,
): (T | undefined)[] {
  const next = store.slice(0, total);
  while (next.length < total) next.push(undefined);
  for (let i = 0; i < chunkItems.length; i++) {
    if (offset + i < total) next[offset + i] = chunkItems[i];
  }
  return next;
}
