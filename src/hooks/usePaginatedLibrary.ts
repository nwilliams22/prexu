import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";
import { getLibraryItems } from "../services/plex-library";
import type { PlexMediaItem } from "../types/library";

const PAGE_SIZE = 50;

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
  sort: string = "titleSort:asc"
): UsePaginatedLibraryResult {
  const { server } = useAuth();
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
        const result = await getLibraryItems(
          server.uri,
          server.accessToken,
          sectionId,
          { start: 0, size: PAGE_SIZE, sort }
        );
        if (!cancelled) {
          setItems(result.items);
          setTotalSize(result.totalSize);
          setHasMore(result.hasMore);
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
  }, [server, sectionId, sort, refreshTrigger]);

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
          { start: items.length, size: PAGE_SIZE, sort }
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
  }, [server, sectionId, sort, items.length, hasMore]);

  return { items, isLoading, isLoadingMore, hasMore, totalSize, error, loadMore, retry };
}
