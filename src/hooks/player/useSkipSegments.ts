import { useState, useRef, useCallback, useEffect } from "react";
import type { PlexMarker, PlexChapter } from "../../types/library";
import { logger } from "../../services/logger";

export interface ActiveSegment {
  type: "intro" | "credits";
  endTime: number; // seconds
}

export interface SkipSegmentsResult {
  activeSegment: ActiveSegment | null;
  dismissSegment: () => void;
}

interface SegmentRange {
  type: "intro" | "credits";
  startMs: number;
  endMs: number;
}

/**
 * Detect whether playback is currently within an intro or credits segment.
 *
 * Primary source: Plex Marker[] (server-detected intro/credits regions).
 * Fallback: Chapter[] tags containing "intro" or "credits" (case-insensitive).
 *
 * Uses refs to avoid re-renders on every timeupdate — only updates state when
 * entering or leaving a segment boundary.
 */
export function useSkipSegments(
  markers: PlexMarker[],
  chapters: PlexChapter[],
  currentTime: number,
  enabled: { intro: boolean; credits: boolean },
  /** Reset trigger — pass the current ratingKey so per-episode state
   *  (dismissals, last-active segment) clears on every navigation. Without
   *  this the hook can carry a stale prevActiveRef across episodes when the
   *  Player component stays mounted (React Router behaviour for same-route
   *  param changes). */
  resetKey?: string,
): SkipSegmentsResult {
  const [activeSegment, setActiveSegment] = useState<ActiveSegment | null>(null);
  const prevActiveRef = useRef<string | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());

  // Build segment list from markers (preferred) or chapters (fallback)
  const segments = useSegments(markers, chapters);

  // Reset all per-episode state when the resetKey (ratingKey) changes.
  // Earlier this keyed on `[markers, chapters]` reference identity which was
  // theoretically correct but fragile against any caching layer that returned
  // identical references across episodes. The ratingKey is unambiguous —
  // every navigation between episodes guarantees a new value.
  useEffect(() => {
    logger.debug("player:skip", "reset (resetKey changed)", {
      resetKey,
      segmentsCount: segments.length,
    });
    dismissedRef.current = new Set();
    prevActiveRef.current = null;
    setActiveSegment(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- segments intentionally excluded; we only want to reset on episode change
  }, [resetKey]);

  // Check if currentTime falls within any segment
  const currentMs = currentTime * 1000;
  let matchedSegment: ActiveSegment | null = null;

  for (const seg of segments) {
    if (currentMs >= seg.startMs && currentMs < seg.endMs) {
      // Check if this segment type is enabled
      if (seg.type === "intro" && !enabled.intro) continue;
      if (seg.type === "credits" && !enabled.credits) continue;

      const segKey = `${seg.type}-${seg.startMs}`;
      if (!dismissedRef.current.has(segKey)) {
        matchedSegment = {
          type: seg.type,
          endTime: seg.endMs / 1000,
        };
      }
      break;
    }
  }

  // Only update state when the active segment changes (boundary detection)
  const matchKey = matchedSegment
    ? `${matchedSegment.type}-${matchedSegment.endTime}`
    : null;

  if (matchKey !== prevActiveRef.current) {
    logger.debug("player:skip", "active segment transition", {
      from: prevActiveRef.current,
      to: matchKey,
      currentMs,
      segmentsKnown: segments.length,
    });
    prevActiveRef.current = matchKey;
    // Use queueMicrotask to avoid setState during render
    queueMicrotask(() => setActiveSegment(matchedSegment));
  }

  const dismissSegment = useCallback(() => {
    if (activeSegment) {
      const currentSegMs = activeSegment.endTime * 1000;
      // Find matching segment to get the startMs for the key
      for (const seg of segments) {
        if (seg.endMs === currentSegMs && seg.type === activeSegment.type) {
          dismissedRef.current.add(`${seg.type}-${seg.startMs}`);
          break;
        }
      }
      prevActiveRef.current = null;
      setActiveSegment(null);
    }
  }, [activeSegment, segments]);

  return { activeSegment, dismissSegment };
}

/**
 * Build normalized segment ranges from markers or chapters.
 * Memoized via ref to avoid recomputing every render.
 */
function useSegments(
  markers: PlexMarker[],
  chapters: PlexChapter[]
): SegmentRange[] {
  // Cache by reference identity, not length. Most TV episodes have 2 markers
  // (intro + credits), so a length-only cache returned the prior episode's
  // segments — including their startMs values — when navigating to a new
  // episode of the same shape. Plex returns fresh arrays per metadata fetch
  // so === changes between episodes; within an episode the parent passes the
  // same reference per render so === holds and the cache hit stays cheap.
  const cacheRef = useRef<{
    markers: PlexMarker[] | null;
    chapters: PlexChapter[] | null;
    result: SegmentRange[];
  }>({ markers: null, chapters: null, result: [] });

  if (
    cacheRef.current.markers === markers &&
    cacheRef.current.chapters === chapters
  ) {
    return cacheRef.current.result;
  }

  let result: SegmentRange[];

  if (markers.length > 0) {
    // Use Plex markers (authoritative)
    result = markers.map((m) => ({
      type: m.type,
      startMs: m.startTimeOffset,
      endMs: m.endTimeOffset,
    }));
  } else {
    // Fallback: scan chapter tags for "intro" / "credits"
    result = chapters
      .filter((ch) => {
        const tag = ch.tag.toLowerCase();
        return tag.includes("intro") || tag.includes("credits");
      })
      .map((ch) => ({
        type: ch.tag.toLowerCase().includes("intro")
          ? ("intro" as const)
          : ("credits" as const),
        startMs: ch.startTimeOffset,
        endMs: ch.endTimeOffset,
      }));
  }

  cacheRef.current = { markers, chapters, result };
  return result;
}
