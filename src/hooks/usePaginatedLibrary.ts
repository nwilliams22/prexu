import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "./useAuth";
import { getLibraryItems } from "../services/plex-library";
import type { PlexMediaItem, LibraryFilters } from "../types/library";

const PAGE_SIZE = 50;
/** Batch size used during progressive background loading */
const BG_BATCH_SIZE = 200;

export interface UsePaginatedLibraryResult {
  items: PlexMediaItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  totalSize: number;
  error: string | null;
  loadMore: () => void;
  retry: () => void;
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
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const retry = useCallback(() => {
    setRefreshTrigger((n) => n + 1);
  }, []);

  const loadAll = options.loadAll ?? false;
  const plexType = options.type;

  // Reset when section or sort changes
  useEffect(() => {
    if (!server || !sectionId) return;

    let cancelled = false;
    loadingRef.current = true;

    (async () => {
      setIsLoading(true);
      setError(null);
      setItems([]);
      try {
        if (loadAll) {
          // ── Progressive loading: first batch fast, then background fill ──
          // Fetch the first page immediately so the grid renders fast
          const firstPage = await getLibraryItems(
            server.uri,
            server.accessToken,
            sectionId,
            { start: 0, size: PAGE_SIZE, sort, filters, type: plexType }
          );

          if (cancelled) return;

          setItems(firstPage.items);
          setTotalSize(firstPage.totalSize);
          setHasMore(false); // disable manual loadMore during progressive load
          setIsLoading(false);
          loadingRef.current = false;

          // If there are more items, fetch them in background batches
          if (firstPage.hasMore) {
            setIsLoadingMore(true);
            let offset = firstPage.items.length;
            const total = firstPage.totalSize;

            while (offset < total && !cancelled) {
              const batch = await getLibraryItems(
                server.uri,
                server.accessToken,
                sectionId,
                { start: offset, size: BG_BATCH_SIZE, sort, filters, type: plexType }
              );

              if (cancelled) return;

              setItems((prev) => [...prev, ...batch.items]);
              offset += batch.items.length;

              // Safety: if server returned 0 items, stop to avoid infinite loop
              if (batch.items.length === 0) break;
            }

            if (!cancelled) {
              setIsLoadingMore(false);
            }
          }
        } else {
          // ── Standard pagination: single page ──
          const result = await getLibraryItems(
            server.uri,
            server.accessToken,
            sectionId,
            { start: 0, size: PAGE_SIZE, sort, filters, type: plexType }
          );
          if (!cancelled) {
            setItems(result.items);
            setTotalSize(result.totalSize);
            setHasMore(result.hasMore);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load library"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          loadingRef.current = false;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, sectionId, sort, filtersKey, refreshTrigger, loadAll, plexType]);

  const loadMore = useCallback(() => {
    if (!server || !sectionId || loadingRef.current || !hasMore) return;

    loadingRef.current = true;
    setIsLoadingMore(true);

    (async () => {
      try {
        const result = await getLibraryItems(
          server.uri,
          server.accessToken,
          sectionId,
          { start: items.length, size: PAGE_SIZE, sort, filters, type: plexType }
        );
        setItems((prev) => [...prev, ...result.items]);
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
  }, [server, sectionId, sort, filtersKey, items.length, hasMore, plexType]);

  return { items, isLoading, isLoadingMore, hasMore, totalSize, error, loadMore, retry };
}
