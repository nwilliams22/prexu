import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";
import { useLibrary } from "./useLibrary";
import { getCollections, getCollectionItems } from "../services/plex-library";
import { cacheGet, cacheSet, cacheInvalidate } from "../services/api-cache";
import type { LibrarySection, PlexCollection } from "../types/library";

export interface CollectionGroup {
  section: LibrarySection;
  items: PlexCollection[];
}

export interface UseCollectionsResult {
  collections: CollectionGroup[];
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

const CACHE_KEY = "collections:all";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function useCollections(): UseCollectionsResult {
  const { server } = useAuth();
  const { sections } = useLibrary();
  const [collections, setCollections] = useState<CollectionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const retry = useCallback(() => {
    cacheInvalidate(CACHE_KEY);
    setRefreshTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!server || sections.length === 0) return;

    const cached = cacheGet<CollectionGroup[]>(CACHE_KEY);
    if (cached) {
      setCollections(cached);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const eligible = sections.filter(
      (s) => s.type === "movie" || s.type === "show"
    );

    Promise.all(
      eligible.map(async (section) => {
        try {
          const items = await getCollections(
            server.uri,
            server.accessToken,
            section.key
          );
          return { section, items };
        } catch {
          return { section, items: [] as PlexCollection[] };
        }
      })
    )
      .then((groups) => {
        if (!cancelled) {
          const filtered = groups.filter((g) => g.items.length > 0);
          setCollections(filtered);
          cacheSet(CACHE_KEY, filtered, CACHE_TTL);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load collections"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [server, sections, refreshTrigger]);

  return { collections, isLoading, error, retry };
}

/* ------------------------------------------------------------------ */
/*  Single-section collections hook (for LibraryView toggle)          */
/* ------------------------------------------------------------------ */

/** Map of collection ratingKey → true if ALL items in that collection are watched */
export type CollectionWatchedMap = Record<string, boolean>;

export interface UseSectionCollectionsResult {
  collections: PlexCollection[];
  watchedMap: CollectionWatchedMap;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

export function useSectionCollections(
  sectionId: string | undefined
): UseSectionCollectionsResult {
  const { server } = useAuth();
  const [collections, setCollections] = useState<PlexCollection[]>([]);
  const [watchedMap, setWatchedMap] = useState<CollectionWatchedMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const cacheKey = sectionId ? `collections:section:${sectionId}` : "";
  const watchedCacheKey = sectionId ? `collections:watched:${sectionId}` : "";

  const retry = useCallback(() => {
    if (cacheKey) cacheInvalidate(cacheKey);
    if (watchedCacheKey) cacheInvalidate(watchedCacheKey);
    setRefreshTrigger((n) => n + 1);
  }, [cacheKey, watchedCacheKey]);

  useEffect(() => {
    if (!server || !sectionId) {
      setCollections([]);
      setWatchedMap({});
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    // Fetch items for each collection to determine if fully watched.
    // Batched to avoid saturating browser connections (max 3 concurrent).
    function fetchWatchedStatus(colls: PlexCollection[]) {
      if (!server || colls.length === 0) return;
      const BATCH_SIZE = 3;

      (async () => {
        const allEntries: (readonly [string, boolean])[] = [];
        for (let i = 0; i < colls.length; i += BATCH_SIZE) {
          if (cancelled) return;
          const batch = colls.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async (c) => {
              try {
                const result = await getCollectionItems(
                  server.uri,
                  server.accessToken,
                  c.ratingKey
                );
                // A collection is "fully watched" if every item has viewCount > 0
                const allWatched =
                  result.items.length > 0 &&
                  result.items.every((item) => {
                    const vc = (item as { viewCount?: number }).viewCount;
                    // For shows, check viewedLeafCount === leafCount
                    const asShow = item as {
                      viewedLeafCount?: number;
                      leafCount?: number;
                    };
                    if (
                      asShow.viewedLeafCount !== undefined &&
                      asShow.leafCount !== undefined
                    ) {
                      return (
                        asShow.leafCount > 0 &&
                        asShow.viewedLeafCount >= asShow.leafCount
                      );
                    }
                    return vc !== undefined && vc > 0;
                  });
                return [c.ratingKey, allWatched] as const;
              } catch {
                return [c.ratingKey, false] as const;
              }
            })
          );
          allEntries.push(...results);
          // Update incrementally after each batch so the unwatched filter works during loading
          if (!cancelled) {
            const batchMap = Object.fromEntries(results);
            setWatchedMap((prev) => ({ ...prev, ...batchMap }));
          }
        }
        if (!cancelled) {
          const finalMap = Object.fromEntries(allEntries);
          cacheSet(watchedCacheKey, finalMap, CACHE_TTL);
        }
      })();
    }

    const cached = cacheGet<PlexCollection[]>(cacheKey);
    const cachedWatched = cacheGet<CollectionWatchedMap>(watchedCacheKey);
    if (cached) {
      setCollections(cached);
      if (cachedWatched) setWatchedMap(cachedWatched);
      setIsLoading(false);
      // If collections are cached but watched status isn't, fetch watched status
      if (!cachedWatched) {
        fetchWatchedStatus(cached);
      }
      return () => { cancelled = true; };
    }

    setIsLoading(true);
    setError(null);

    getCollections(server.uri, server.accessToken, sectionId)
      .then((items) => {
        if (!cancelled) {
          setCollections(items);
          cacheSet(cacheKey, items, CACHE_TTL);
          // Fetch watched status for each collection in the background
          fetchWatchedStatus(items);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load collections"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [server, sectionId, cacheKey, watchedCacheKey, refreshTrigger]);

  return { collections, watchedMap, isLoading, error, retry };
}
