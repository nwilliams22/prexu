import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "./useAuth";
import { getLibraryItems } from "../services/plex-library";
import { cacheGet, cacheSet, cacheInvalidate } from "../services/api-cache";
import { logger } from "../services/logger";
import {
  expandRange,
  chunkOffsetsForRange,
  isChunkLoaded,
  mergeChunk,
  RANGE_CHUNK_SIZE,
  RANGE_OVERSCAN,
} from "./library-range";
import type { PlexMediaItem, LibraryFilters } from "../types/library";

const PAGE_SIZE = 50;
/** Batch size used during progressive background loading (loadAll mode) */
const BG_BATCH_SIZE = 200;
/** Cache TTL for library data (5 minutes) */
const CACHE_TTL = 5 * 60 * 1000;
/** Max concurrent background batch requests during a loadAll fetch (prexu-0szx.18) */
const LOAD_ALL_CONCURRENCY = 4;

interface CachedLibrary {
  /** Sparse-by-index store: `undefined` slots mean "not fetched yet". A
   *  fully-populated (loadAll) result is a dense store — a valid special
   *  case of the same shape. */
  store: (PlexMediaItem | undefined)[];
  totalSize: number;
}

export interface UsePaginatedLibraryResult {
  /**
   * Sparse-by-index item store spanning the section: `items[i]` is the item
   * at position `i`, or `undefined` if that position hasn't been fetched
   * yet. Always dense up to `totalSize` (explicit `undefined`, never a real
   * JS array hole) so `.map`/`.filter`/`for...of` visit every index.
   */
  items: (PlexMediaItem | undefined)[];
  isLoading: boolean;
  /** True while any background range fetch (or the loadAll background
   *  batch fill) is in flight. */
  isLoadingMore: boolean;
  /**
   * True while a section/sort/filter change is refetching but the currently
   * rendered `items` still belong to the PREVIOUS combination (kept visible
   * instead of blanking to `[]`). Consumers can dim/aria-busy the grid.
   */
  isStale: boolean;
  totalSize: number;
  error: string | null;
  /**
   * True once every index in `[0, totalSize)` has a defined item — i.e. the
   * store is fully (not sparsely) populated. In `loadAll` mode this flips
   * true when the progressive background fill finishes; in ranged mode it
   * flips true once the user has (incidentally) scrolled through the whole
   * section. Consumers that derive client-side facets from `items` (e.g.
   * cross-filtered filter dropdowns, prexu-hb1p) should gate on this so they
   * never narrow options off of a partial result set.
   */
  isFillComplete: boolean;
  /**
   * Request that the item range `[startIndex, endIndex)` be present in
   * `items`, expanding it by a small overscan margin. Safe to call on every
   * scroll/virtualizer-range tick — in-flight fetches for chunks already
   * covered or already in flight are skipped, and fetches for chunks that
   * fall outside the (expanded) requested range are aborted. No-op in
   * loadAll mode, where the whole section is already being fetched.
   */
  ensureRange: (startIndex: number, endIndex: number) => void;
  retry: () => void;
}

/**
 * Fetch the remaining pages of a loadAll section with bounded concurrency,
 * merging results back in offset order so the grid never renders out-of-order
 * pages (sorted views depend on ascending-offset ordering). Buffers
 * out-of-order completions and flushes the longest ready contiguous prefix in
 * one `onFlush` call — this naturally coalesces multiple near-simultaneous
 * batch completions into fewer state updates than the old one-batch-at-a-time
 * sequential loop.
 */
async function fetchRemainingBatches(params: {
  server: { uri: string; accessToken: string };
  sectionId: string;
  sort: string;
  filters: LibraryFilters;
  plexType: number | undefined;
  startOffset: number;
  total: number;
  signal: AbortSignal;
  onFlush: (items: PlexMediaItem[]) => void;
}): Promise<PlexMediaItem[]> {
  const { server, sectionId, sort, filters, plexType, startOffset, total, signal, onFlush } = params;

  const offsets: number[] = [];
  for (let o = startOffset; o < total; o += BG_BATCH_SIZE) offsets.push(o);
  if (offsets.length === 0) return [];

  const results = new Map<number, PlexMediaItem[]>();
  let nextFlushIndex = 0;
  let flushed: PlexMediaItem[] = [];
  let stopped = false;

  const tryFlush = () => {
    let flushedAny = false;
    while (nextFlushIndex < offsets.length && results.has(offsets[nextFlushIndex]!)) {
      const batchItems = results.get(offsets[nextFlushIndex]!)!;
      results.delete(offsets[nextFlushIndex]!);
      flushed = flushed.concat(batchItems);
      nextFlushIndex++;
      flushedAny = true;
      // Safety: server returned fewer/zero items than expected — stop asking for more.
      if (batchItems.length === 0) {
        stopped = true;
        break;
      }
    }
    if (flushedAny && !signal.aborted) {
      onFlush(flushed);
    }
  };

  let cursor = 0;
  const worker = async () => {
    while (!signal.aborted && !stopped && cursor < offsets.length) {
      const offset = offsets[cursor++]!;
      try {
        const batch = await getLibraryItems(server.uri, server.accessToken, sectionId, {
          start: offset,
          size: BG_BATCH_SIZE,
          sort,
          filters,
          type: plexType,
          signal,
        });
        if (signal.aborted) return;
        results.set(offset, batch.items);
        tryFlush();
      } catch (err) {
        if (signal.aborted) return;
        logger.warn("api", "usePaginatedLibrary: background batch failed, stopping load-all", {
          sectionId,
          offset,
          error: err instanceof Error ? err.message : String(err),
        });
        stopped = true;
        return;
      }
    }
  };

  const workerCount = Math.min(LOAD_ALL_CONCURRENCY, offsets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return flushed;
}

export function usePaginatedLibrary(
  sectionId: string | undefined,
  sort: string = "titleSort:asc",
  filters: LibraryFilters = {},
  options: { loadAll?: boolean; type?: number } = {}
): UsePaginatedLibraryResult {
  const { server } = useAuth();
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);
  const [items, setItems] = useState<(PlexMediaItem | undefined)[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalSize, setTotalSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const totalSizeRef = useRef(0);
  totalSizeRef.current = totalSize;

  // Ranges keyed to the current "generation" (bumped on every section/sort/
  // filter/loadAll change and on unmount). Fetch callbacks compare their
  // captured generation against this ref before touching state, so a rapid
  // filter/sort switch always settles on the LAST selection — stale
  // in-flight responses from an earlier generation are silently dropped.
  const generationRef = useRef(0);
  // Which generation the current `items` state was built for — the first
  // chunk merged for a NEW generation replaces (rather than merges into)
  // whatever the previous generation left behind, so a section switch never
  // splices new-section items into the old section's sparse store.
  const storeGenerationRef = useRef(0);

  // offset -> AbortController for in-flight range fetches (ranged mode only).
  const inFlightRef = useRef<Map<number, AbortController>>(new Map());
  // offsets whose chunk is fully present in `items` — lets ensureRange skip
  // re-requesting a range that's already loaded without re-scanning the array.
  const loadedChunksRef = useRef<Set<number>>(new Set());

  const loadAll = options.loadAll ?? false;
  const plexType = options.type;

  // Build a stable cache key
  const cacheKey = useMemo(() => {
    if (!server || !sectionId) return "";
    return `library:${server.uri}:${sectionId}:${sort}:${filtersKey}:${plexType ?? ""}`;
  }, [server, sectionId, sort, filtersKey, plexType]);

  const retry = useCallback(() => {
    // Invalidate cache so the next fetch is fresh
    if (cacheKey) cacheInvalidate(cacheKey);
    setRefreshTrigger((n) => n + 1);
  }, [cacheKey]);

  /** Fetch one RANGE_CHUNK_SIZE-aligned chunk and merge it into `items`. */
  const fetchChunk = useCallback(
    (offset: number, generation: number) => {
      if (!server || !sectionId) return;

      const controller = new AbortController();
      inFlightRef.current.set(offset, controller);
      setIsLoadingMore(true);
      logger.debug("library", "range chunk fetch start", {
        sectionId,
        offset,
        size: RANGE_CHUNK_SIZE,
        generation,
      });

      (async () => {
        try {
          const result = await getLibraryItems(server.uri, server.accessToken, sectionId, {
            start: offset,
            size: RANGE_CHUNK_SIZE,
            sort,
            filters,
            type: plexType,
            signal: controller.signal,
          });

          if (controller.signal.aborted || generation !== generationRef.current) return;

          inFlightRef.current.delete(offset);
          loadedChunksRef.current.add(offset);
          totalSizeRef.current = result.totalSize;
          setTotalSize(result.totalSize);

          setItems((prev) => {
            // A new generation's first successful chunk replaces the
            // previous generation's (stale, now-irrelevant) store rather
            // than merging into it.
            const base = storeGenerationRef.current === generation ? prev : [];
            storeGenerationRef.current = generation;
            const merged = mergeChunk(base, offset, result.items, result.totalSize);
            cacheSet(cacheKey, { store: merged, totalSize: result.totalSize }, CACHE_TTL);
            return merged;
          });
          setIsLoading(false);
        } catch (err) {
          if (controller.signal.aborted) {
            logger.trace("library", "range chunk fetch aborted", { sectionId, offset });
            return;
          }
          inFlightRef.current.delete(offset);
          logger.warn("api", "usePaginatedLibrary: range chunk fetch failed", {
            sectionId,
            offset,
            error: err instanceof Error ? err.message : String(err),
          });
          if (generation === generationRef.current) {
            setError(err instanceof Error ? err.message : "Failed to load library range");
            setIsLoading(false);
          }
        } finally {
          if (generation === generationRef.current && inFlightRef.current.size === 0) {
            setIsLoadingMore(false);
          }
        }
      })();
    },
    [server, sectionId, sort, filters, plexType, cacheKey],
  );

  /**
   * Range-driven fetch entry point. Called by the grid whenever the visible
   * (+ overscan) item range changes — including instant jumps to the very
   * bottom of the section, which is the whole point: geometry is never
   * blocked on a fetch, only the cards within the newly-visible range are.
   */
  const ensureRange = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!server || !sectionId || loadAll) return;
      const total = totalSizeRef.current;
      if (total <= 0) return; // totalSize not known yet — the initial chunk fetch will discover it

      const generation = generationRef.current;
      const { start, end } = expandRange(startIndex, endIndex, total, RANGE_OVERSCAN);
      const needed = new Set(chunkOffsetsForRange(start, end, total, RANGE_CHUNK_SIZE));

      // Abort in-flight fetches for chunks the user has scrolled past —
      // they're no longer worth the round trip.
      for (const [offset, controller] of inFlightRef.current) {
        if (!needed.has(offset)) {
          controller.abort();
          inFlightRef.current.delete(offset);
          logger.trace("library", "range fetch deprioritized (scrolled past)", {
            sectionId,
            offset,
          });
        }
      }

      for (const offset of needed) {
        if (loadedChunksRef.current.has(offset)) continue;
        if (inFlightRef.current.has(offset)) continue; // de-dup in-flight request
        if (isChunkLoaded(itemsRef.current, offset, RANGE_CHUNK_SIZE, total)) {
          loadedChunksRef.current.add(offset);
          continue;
        }
        fetchChunk(offset, generation);
      }
    },
    [server, sectionId, loadAll, fetchChunk],
  );

  // Reset when section, sort, filters, loadAll mode, or type changes.
  useEffect(() => {
    if (!server || !sectionId) return;

    generationRef.current += 1;
    const generation = generationRef.current;

    // A new combination invalidates every outstanding range fetch from the
    // previous one — their offsets no longer mean anything for this section.
    for (const controller of inFlightRef.current.values()) controller.abort();
    inFlightRef.current.clear();
    loadedChunksRef.current.clear();

    setError(null);

    const cached = cacheGet<CachedLibrary>(cacheKey);
    if (cached) {
      storeGenerationRef.current = generation;
      setItems(cached.store);
      setTotalSize(cached.totalSize);
      totalSizeRef.current = cached.totalSize;
      setIsLoading(false);
      // Re-derive which chunks are already fully loaded so ensureRange
      // doesn't immediately re-request everything the cache already has.
      for (let o = 0; o < cached.totalSize; o += RANGE_CHUNK_SIZE) {
        if (isChunkLoaded(cached.store, o, RANGE_CHUNK_SIZE, cached.totalSize)) {
          loadedChunksRef.current.add(o);
        }
      }
      return;
    }

    // Keep whatever items are currently rendered (previous section/filter/
    // sort) instead of blanking to [] — isStale (derived below) lets the
    // UI dim the stale grid instead of flashing empty + skeleton.
    setIsLoading(true);

    if (loadAll) {
      // ── Progressive loading: first batch fast, then background fill ──
      const controller = new AbortController();
      inFlightRef.current.set(-1, controller);

      (async () => {
        try {
          const firstPage = await getLibraryItems(
            server.uri,
            server.accessToken,
            sectionId,
            { start: 0, size: PAGE_SIZE, sort, filters, type: plexType, signal: controller.signal }
          );

          if (controller.signal.aborted || generation !== generationRef.current) return;

          storeGenerationRef.current = generation;
          const firstStore = mergeChunk<PlexMediaItem>([], 0, firstPage.items, firstPage.totalSize);
          setItems(firstStore);
          setTotalSize(firstPage.totalSize);
          totalSizeRef.current = firstPage.totalSize;
          setIsLoading(false);

          cacheSet(cacheKey, { store: firstStore, totalSize: firstPage.totalSize }, CACHE_TTL);

          if (firstPage.hasMore) {
            setIsLoadingMore(true);

            const restItems = await fetchRemainingBatches({
              server,
              sectionId,
              sort,
              filters,
              plexType,
              startOffset: firstPage.items.length,
              total: firstPage.totalSize,
              signal: controller.signal,
              onFlush: (flushedSoFar) => {
                if (generation !== generationRef.current) return;
                setItems(mergeChunk<PlexMediaItem>(firstStore, firstPage.items.length, flushedSoFar, firstPage.totalSize));
              },
            });

            if (!controller.signal.aborted && generation === generationRef.current) {
              inFlightRef.current.delete(-1);
              setIsLoadingMore(false);
              const allItems = mergeChunk<PlexMediaItem>(firstStore, firstPage.items.length, restItems, firstPage.totalSize);
              setItems(allItems);
              cacheSet(cacheKey, { store: allItems, totalSize: firstPage.totalSize }, CACHE_TTL);
            }
          } else {
            inFlightRef.current.delete(-1);
          }
        } catch (err) {
          if (!controller.signal.aborted && generation === generationRef.current) {
            setError(err instanceof Error ? err.message : "Failed to load library");
          }
        } finally {
          if (!controller.signal.aborted && generation === generationRef.current) {
            setIsLoading(false);
            setIsLoadingMore(false);
          }
        }
      })();
    } else {
      // ── Range-driven: seed the first chunk for a fast paint; the grid's
      //    onRangeChange (via ensureRange) drives everything after that. ──
      fetchChunk(0, generation);
    }

    return () => {
      generationRef.current += 1;
      for (const controller of inFlightRef.current.values()) controller.abort();
      inFlightRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, sectionId, sort, filtersKey, refreshTrigger, loadAll, plexType, cacheKey]);

  const isStale = isLoading && items.some((item) => item !== undefined);

  // Populated-count vs. totalSize, not `isLoadingMore`: the latter also
  // toggles for ranged-mode chunk fetches unrelated to a full-section fill,
  // so it can't be trusted as a "the whole store is dense" signal on its own.
  const populatedCount = useMemo(
    () => items.reduce((count, item) => (item !== undefined ? count + 1 : count), 0),
    [items],
  );
  const isFillComplete = totalSize > 0 && populatedCount >= totalSize;

  return { items, isLoading, isLoadingMore, isStale, totalSize, error, isFillComplete, ensureRange, retry };
}
