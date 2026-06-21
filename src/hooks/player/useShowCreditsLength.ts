/**
 * Estimate a show's typical credits length so episodes whose own Plex
 * markers are missing still get a reasonably-positioned synthetic
 * "Next Episode" prompt (see useSkipSegments).
 *
 * Strategy: when an episode is loaded, fetch its parent season's children
 * with markers, take each episode's `(duration - earliest credits.startMs)`,
 * and return the median in milliseconds. The median tolerates outliers
 * (cold opens, post-credit scenes) better than a mean.
 *
 * Result is cached in localStorage by parentRatingKey for 7 days. The
 * cache survives reloads so subsequent episode loads in the same season
 * skip the fetch entirely.
 */

import { useEffect, useState } from "react";
import {
  getItemChildren,
  getItemMetadata,
} from "../../services/plex-library";
import type { PlexEpisode } from "../../types/library";
import { logger } from "../../services/logger";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_KEY_PREFIX = "prexu.creditsLen.";
/** Need at least this many sibling episodes with credits markers before
 *  we trust the median. Below this we return null and the caller falls
 *  back to its hard-coded default window. */
const MIN_SAMPLES = 3;
/** Cap on per-episode metadata fetches per season-load. The parent's
 *  /children endpoint doesn't include Marker[] arrays even with
 *  ?includeMarkers=1 (verified empirically), so we have to fetch each
 *  episode individually via getItemMetadata which DOES return markers.
 *  Sampling instead of fetching all 13/24/N episodes keeps the cost
 *  bounded; the median is robust enough that a sample of 6 lines up
 *  with the population median in the common case. */
const MAX_SAMPLE_FETCHES = 6;

interface CacheEntry {
  median: number;
  samples: number;
  storedAt: number;
}

/**
 * Pure helper — exposed for tests. Returns the median credits-length in ms
 * across episodes that have at least one credits Marker AND a non-zero
 * duration, or null if there are fewer than MIN_SAMPLES qualifying episodes.
 */
export function estimateCreditsLengthMs(episodes: PlexEpisode[]): number | null {
  const lengths: number[] = [];
  for (const ep of episodes) {
    if (!ep.duration || !ep.Marker || ep.Marker.length === 0) continue;
    // Use the EARLIEST credits marker for this episode — Plex sometimes
    // emits multiple consecutive credits markers (e.g. mid-credit scene
    // breaks). The leading edge is what defines "credits start".
    let creditsStart: number | null = null;
    for (const m of ep.Marker) {
      if (m.type !== "credits") continue;
      if (creditsStart === null || m.startTimeOffset < creditsStart) {
        creditsStart = m.startTimeOffset;
      }
    }
    if (creditsStart === null) continue;
    const len = ep.duration - creditsStart;
    if (len > 0) lengths.push(len);
  }
  if (lengths.length < MIN_SAMPLES) return null;
  lengths.sort((a, b) => a - b);
  const mid = Math.floor(lengths.length / 2);
  // For odd counts: middle element. For even counts: average of the two
  // straddling the middle (standard median definition).
  return lengths.length % 2 === 0
    ? Math.round((lengths[mid - 1]! + lengths[mid]!) / 2)
    : lengths[mid]!;
}

function readCache(parentRatingKey: string): number | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + parentRatingKey);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (
      typeof entry.median !== "number" ||
      typeof entry.storedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY_PREFIX + parentRatingKey);
      return null;
    }
    return entry.median;
  } catch {
    return null;
  }
}

function writeCache(parentRatingKey: string, median: number, samples: number) {
  try {
    const entry: CacheEntry = { median, samples, storedAt: Date.now() };
    localStorage.setItem(
      CACHE_KEY_PREFIX + parentRatingKey,
      JSON.stringify(entry),
    );
  } catch {
    // localStorage quota / unavailable — caller falls back to default window
  }
}

export function useShowCreditsLength(
  server: { uri: string; accessToken: string } | null,
  parentRatingKey: string | undefined,
): number | null {
  const [creditsLengthMs, setCreditsLengthMs] = useState<number | null>(() => {
    if (!parentRatingKey) return null;
    return readCache(parentRatingKey);
  });

  useEffect(() => {
    if (!server || !parentRatingKey) return;

    const cached = readCache(parentRatingKey);
    if (cached != null) {
      setCreditsLengthMs(cached);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // Step 1: get the season's episode list (no markers — Plex's
        // children endpoint doesn't surface them even with includeMarkers=1,
        // verified empirically against a 25-ep season that returned 0 marker
        // arrays from the children call despite the same episodes having
        // markers when fetched individually).
        const stub = await getItemChildren<PlexEpisode>(
          server.uri,
          server.accessToken,
          parentRatingKey,
        );
        if (cancelled) return;
        if (stub.length === 0) return;

        // Step 2: sample up to MAX_SAMPLE_FETCHES episodes evenly spaced
        // across the season and fetch each individually — getItemMetadata
        // DOES include Marker[] when includeMarkers=1 (its existing default).
        // Even sampling avoids bias from a season that opens or closes with
        // unusual episodes (recap, special, etc.).
        const stride = Math.max(1, Math.floor(stub.length / MAX_SAMPLE_FETCHES));
        const sampleKeys: string[] = [];
        for (let i = 0; i < stub.length && sampleKeys.length < MAX_SAMPLE_FETCHES; i += stride) {
          sampleKeys.push(stub[i]!.ratingKey);
        }

        const settled = await Promise.allSettled(
          sampleKeys.map((rk) =>
            getItemMetadata<PlexEpisode>(server.uri, server.accessToken, rk),
          ),
        );
        if (cancelled) return;

        const episodes: PlexEpisode[] = settled
          .filter((r): r is PromiseFulfilledResult<PlexEpisode> => r.status === "fulfilled")
          .map((r) => r.value);

        const median = estimateCreditsLengthMs(episodes);
        const sampleCount = episodes.filter(
          (e) => e.Marker?.some((m) => m.type === "credits"),
        ).length;
        logger.info("player:creditsLen", "computed median", {
          parentRatingKey,
          totalEpisodes: stub.length,
          sampledEpisodes: episodes.length,
          sampleCount,
          medianMs: median,
        });
        if (median != null) {
          writeCache(parentRatingKey, median, sampleCount);
          setCreditsLengthMs(median);
        }
      } catch (err) {
        logger.warn(
          "player:creditsLen",
          "fetch failed",
          err instanceof Error ? err.message : String(err),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, parentRatingKey]);

  return creditsLengthMs;
}
