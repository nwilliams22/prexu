import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";
import { getWatchHistory } from "../services/plex-library";
import { cacheGet, cacheSet, cacheInvalidate } from "../services/api-cache";
import type { PlexMediaItem, PaginatedResult } from "../types/library";

const PAGE_SIZE = 50;
const CACHE_KEY = "watchHistory:page0";
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export interface UseWatchHistoryResult {
  items: PlexMediaItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  totalSize: number;
  error: string | null;
  loadMore: () => void;
  retry: () => void;
}

export function useWatchHistory(): UseWatchHistoryResult {
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
    cacheInvalidate(CACHE_KEY);
    setRefreshTrigger((n) => n + 1);
  }, []);

  // Initial fetch
  useEffect(() => {
    if (!server) return;

    // Check cache for first page
    const cached = cacheGet<PaginatedResult<PlexMediaItem>>(CACHE_KEY);
    if (cached) {
      setItems(cached.items);
      setTotalSize(cached.totalSize);
      setHasMore(cached.hasMore);
      setIsLoading(false);
      loadingRef.current = false;
      return;
    }

    let cancelled = false;
    loadingRef.current = true;

    (async () => {
      setIsLoading(true);
      setError(null);
      setItems([]);
      try {
        const result = await getWatchHistory(
          server.uri,
          server.accessToken,
          { start: 0, size: PAGE_SIZE }
        );
        if (!cancelled) {
          setItems(result.items);
          setTotalSize(result.totalSize);
          setHasMore(result.hasMore);
          cacheSet(CACHE_KEY, result, CACHE_TTL);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load watch history"
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
  }, [server, refreshTrigger]);

  const loadMore = useCallback(() => {
    if (!server || loadingRef.current || !hasMore) return;

    loadingRef.current = true;
    setIsLoadingMore(true);

    (async () => {
      try {
        const result = await getWatchHistory(
          server.uri,
          server.accessToken,
          { start: items.length, size: PAGE_SIZE }
        );
        setItems((prev) => [...prev, ...result.items]);
        setHasMore(result.hasMore);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load more history"
        );
      } finally {
        setIsLoadingMore(false);
        loadingRef.current = false;
      }
    })();
  }, [server, items.length, hasMore]);

  return { items, isLoading, isLoadingMore, hasMore, totalSize, error, loadMore, retry };
}
