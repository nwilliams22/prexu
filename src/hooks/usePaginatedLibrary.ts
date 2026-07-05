import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "./useAuth";
import { getLibraryItems } from "../services/plex-library";
import { cacheGet, cacheSet, cacheInvalidate } from "../services/api-cache";
import { logger } from "../services/logger";
import type { PlexMediaItem, LibraryFilters } from "../types/library";

const PAGE_SIZE = 50;
/** Batch size used during progressive background loading */
const BG_BATCH_SIZE = 200;
/** Cache TTL for library data (5 minutes) */
const CACHE_TTL = 5 * 60 * 1000;
/** Max concurrent background batch requests during a loadAll fetch (prexu-0szx.18) */
const LOAD_ALL_CONCURRENCY = 4;

interface CachedLibrary {
  items: PlexMediaItem[];
  totalSize: number;
  hasMore: boolean;
}

export interface UsePaginatedLibraryResult {
  items: PlexMediaItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  /**
   * True while a section/sort/filter change is refetching but the currently
   * rendered `items` still belong to the PREVIOUS combination (kept visible
   * instead of blanking to `[]`). Consumers can dim/aria-busy the grid.
   */
  isStale: boolean;
  hasMore: boolean;
  totalSize: number;
  error: string | null;
  loadMore: () => void;
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
  const [items, setItems] = useState<PlexMediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalSize, setTotalSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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

  // Reset when section or sort changes
  useEffect(() => {
    if (!server || !sectionId) return;

    // Check cache first for instant display
    const cached = cacheGet<CachedLibrary>(cacheKey);
    if (cached) {
      setItems(cached.items);
      setTotalSize(cached.totalSize);
      setHasMore(cached.hasMore);
      setIsLoading(false);
      loadingRef.current = false;
      return;
    }

    const controller = new AbortController();
    loadingRef.current = true;

    (async () => {
      setIsLoading(true);
      setError(null);
      // Keep whatever items are currently rendered (previous section/filter/
      // sort) instead of blanking to [] — isStale (derived below) lets the
      // UI dim the stale grid instead of flashing empty + skeleton.
      try {
        if (loadAll) {
          // ── Progressive loading: first batch fast, then background fill ──
          // Fetch the first page immediately so the grid renders fast
          const firstPage = await getLibraryItems(
            server.uri,
            server.accessToken,
            sectionId,
            { start: 0, size: PAGE_SIZE, sort, filters, type: plexType, signal: controller.signal }
          );

          if (controller.signal.aborted) return;

          setItems(firstPage.items);
          setTotalSize(firstPage.totalSize);
          setHasMore(false); // disable manual loadMore during progressive load
          setIsLoading(false);
          loadingRef.current = false;

          // Cache the first page immediately for fast re-visit
          cacheSet(cacheKey, { items: firstPage.items, totalSize: firstPage.totalSize, hasMore: false }, CACHE_TTL);

          // If there are more items, fetch them in background batches
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
                setItems([...firstPage.items, ...flushedSoFar]);
              },
            });

            if (!controller.signal.aborted) {
              setIsLoadingMore(false);
              const allItems = [...firstPage.items, ...restItems];
              cacheSet(cacheKey, { items: allItems, totalSize: firstPage.totalSize, hasMore: false }, CACHE_TTL);
            }
          }
        } else {
          // ── Standard pagination: single page ──
          const result = await getLibraryItems(
            server.uri,
            server.accessToken,
            sectionId,
            { start: 0, size: PAGE_SIZE, sort, filters, type: plexType, signal: controller.signal }
          );
          if (!controller.signal.aborted) {
            setItems(result.items);
            setTotalSize(result.totalSize);
            setHasMore(result.hasMore);
            cacheSet(cacheKey, { items: result.items, totalSize: result.totalSize, hasMore: result.hasMore }, CACHE_TTL);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Failed to load library"
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          loadingRef.current = false;
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [server, sectionId, sort, filtersKey, refreshTrigger, loadAll, plexType, cacheKey]);

  const loadMore = useCallback(() => {
    if (!server || !sectionId || loadingRef.current || !hasMore) return;

    loadingRef.current = true;
    setIsLoadingMore(true);

    const offset = itemsRef.current.length;

    (async () => {
      try {
        const result = await getLibraryItems(
          server.uri,
          server.accessToken,
          sectionId,
          { start: offset, size: PAGE_SIZE, sort, filters, type: plexType }
        );
        setItems((prev) => {
          const updated = [...prev, ...result.items];
          cacheSet(cacheKey, { items: updated, totalSize, hasMore: result.hasMore }, CACHE_TTL);
          return updated;
        });
        setHasMore(result.hasMore);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load more items"
        );
      } finally {
        setIsLoadingMore(false);
        loadingRef.current = false;
      }
    })();
  }, [server, sectionId, sort, filtersKey, hasMore, plexType, cacheKey, totalSize]);

  const isStale = isLoading && items.length > 0;

  return { items, isLoading, isLoadingMore, isStale, hasMore, totalSize, error, loadMore, retry };
}
