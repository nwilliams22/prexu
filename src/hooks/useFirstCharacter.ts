import { useState, useEffect, useMemo } from "react";
import { useAuth } from "./useAuth";
import { getSectionFirstCharacter } from "../services/plex-library";
import { cacheGet, cacheSet } from "../services/api-cache";
import { logger } from "../services/logger";
import type { FirstCharacterBucket } from "../services/plex-library";

/** Cache TTL for the firstCharacter index (matches filter-options lifetime) */
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface UseFirstCharacterResult {
  /**
   * Letters present in the section (e.g. ["#", "A", "B", ...]).
   * Empty while loading or when the endpoint is unavailable.
   */
  letters: Set<string>;
  /**
   * Raw buckets returned by the Plex API, in the order the server sends them.
   * Useful for computing cumulative offsets.
   */
  buckets: FirstCharacterBucket[];
  /** True while the first fetch is in-flight */
  isLoading: boolean;
  /** Set when the endpoint fails; callers should fall back gracefully */
  error: string | null;
}

/**
 * Fetches the per-letter item-count index for a library section.
 *
 * Powered by `/library/sections/{id}/firstCharacter` — a cheap metadata
 * endpoint that returns one bucket per distinct first character of item
 * sort-titles. Does NOT load any media items; suitable for powering the
 * AlphaJumpBar without triggering a full-section load.
 *
 * Only active when `enabled` is true (i.e. the caller actually needs
 * alpha-jump behaviour). Pass `enabled: false` to skip the fetch entirely
 * (e.g. for non-default sorts where the jump bar is hidden).
 */
export function useFirstCharacter(
  sectionId: string | undefined,
  enabled: boolean
): UseFirstCharacterResult {
  const { server } = useAuth();

  const cacheKey = useMemo(() => {
    if (!server || !sectionId || !enabled) return "";
    return `firstCharacter:${server.uri}:${sectionId}`;
  }, [server, sectionId, enabled]);

  const [buckets, setBuckets] = useState<FirstCharacterBucket[]>(() => {
    if (!cacheKey) return [];
    return cacheGet<FirstCharacterBucket[]>(cacheKey) ?? [];
  });
  const [isLoading, setIsLoading] = useState(() => {
    if (!cacheKey) return false;
    return !cacheGet<FirstCharacterBucket[]>(cacheKey);
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server || !sectionId || !enabled || !cacheKey) {
      setBuckets([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Serve from cache immediately when available
    const cached = cacheGet<FirstCharacterBucket[]>(cacheKey);
    if (cached) {
      setBuckets(cached);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        logger.debug("api", "getSectionFirstCharacter", { sectionId });
        const result = await getSectionFirstCharacter(
          server.uri,
          server.accessToken,
          sectionId
        );
        if (!cancelled) {
          logger.debug("api", "getSectionFirstCharacter result", {
            sectionId,
            bucketCount: result.length,
            letters: result.map((b) => b.key).join(""),
          });
          setBuckets(result);
          cacheSet(cacheKey, result, CACHE_TTL);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Failed to load first-character index";
          logger.debug("api", "getSectionFirstCharacter failed", { sectionId, error: msg });
          setError(msg);
          // Leave buckets as [] so caller falls back gracefully
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
  }, [server, sectionId, enabled, cacheKey]);

  const letters = useMemo(() => {
    const set = new Set<string>();
    for (const b of buckets) {
      if (b.size > 0) set.add(b.key);
    }
    return set;
  }, [buckets]);

  return { letters, buckets, isLoading, error };
}

/**
 * Given an ordered list of firstCharacter buckets, compute the cumulative
 * start offset (0-based item index) for each letter.
 *
 * Example: buckets [{ key: "#", size: 3 }, { key: "A", size: 10 }, ...]
 *   → { "#": 0, "A": 3, "B": 13, ... }
 *
 * The offset is the index of the FIRST item in that bucket within the
 * sorted full list — exactly what `scrollToIndex` on VirtualizedLibraryGrid
 * expects.
 */
export function computeLetterOffsets(
  buckets: FirstCharacterBucket[]
): Map<string, number> {
  const offsets = new Map<string, number>();
  let cursor = 0;
  for (const bucket of buckets) {
    offsets.set(bucket.key, cursor);
    cursor += bucket.size;
  }
  return offsets;
}
