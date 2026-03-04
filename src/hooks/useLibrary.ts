import { useState, useEffect } from "react";
import { useAuth } from "./useAuth";
import { getLibrarySections } from "../services/plex-library";
import { cacheGet, cacheSet } from "../services/api-cache";
import type { LibrarySection } from "../types/library";

export interface UseLibraryResult {
  sections: LibrarySection[];
  isLoading: boolean;
  error: string | null;
}

const CACHE_KEY_PREFIX = "library-sections:";
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetches library sections with stale-while-revalidate caching.
 *
 * On mount, returns any cached sections immediately (from localStorage
 * if the in-memory cache is empty) so the sidebar renders instantly.
 * Then fetches fresh data in the background and updates.
 */
export function useLibrary(): UseLibraryResult {
  const { server } = useAuth();
  const cacheKey = server ? `${CACHE_KEY_PREFIX}${server.uri}` : "";

  const [sections, setSections] = useState<LibrarySection[]>(() => {
    if (!cacheKey) return [];
    return cacheGet<LibrarySection[]>(cacheKey) ?? [];
  });
  const [isLoading, setIsLoading] = useState(() => {
    // If we have cached sections, we're not in a loading state
    if (!cacheKey) return true;
    return !cacheGet<LibrarySection[]>(cacheKey);
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server) return;

    let cancelled = false;

    // Check cache — if we have cached data, show it immediately
    const cached = cacheGet<LibrarySection[]>(cacheKey);
    if (cached) {
      setSections(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    // Always fetch fresh data in the background (stale-while-revalidate)
    (async () => {
      setError(null);
      try {
        const result = await getLibrarySections(server.uri, server.accessToken);
        if (!cancelled) {
          setSections(result);
          cacheSet(cacheKey, result, CACHE_TTL, true);
        }
      } catch (err) {
        if (!cancelled) {
          // Only set error if we have no cached data to show
          if (!cached) {
            setError(
              err instanceof Error ? err.message : "Failed to load libraries"
            );
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, cacheKey]);

  return { sections, isLoading, error };
}
