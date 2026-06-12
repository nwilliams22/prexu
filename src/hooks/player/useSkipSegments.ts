import { useState, useRef, useCallback, useEffect, useMemo } from "react";
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

/** Default fallback for the synthetic "Next Episode" prompt when Plex
 *  didn't provide a credits marker AND we couldn't estimate the show's
 *  typical credits length from sibling episodes. 90s lines up with the
 *  typical outro length on TV anime / dramas; bigger values risk showing
 *  the prompt over actual story content. Overridden by the
 *  `synthCreditsWindowMs` arg when callers can pass a per-show estimate. */
const DEFAULT_SYNTH_CREDITS_WINDOW_MS = 90_000;

/** How far before exact file end a skip-credits seek should land
 *  (prexu-7fe.2). Seeking to duration parks the playhead at the EOF
 *  boundary without playback consuming the final frame, so mpv's
 *  eof-reached property never flips. Backing off 0.5s gives playback
 *  room to roll to EOF naturally when the user resumes play, emitting
 *  eof-reached the same way a normal end-of-episode does. */
const EOF_CLAMP_BACKOFF_S = 0.5;

/**
 * Clamp a skip-segment seek target away from the exact file end so
 * playback can roll to EOF naturally. Returns the input unchanged when
 * duration is unknown (≤0) or when target is already comfortably
 * inside the file. See prexu-7fe.2 for the bug this fixes.
 */
export function clampSkipTarget(target: number, duration: number): number {
  if (duration <= 0) return target;
  if (target < duration - EOF_CLAMP_BACKOFF_S) return target;
  return Math.max(0, duration - EOF_CLAMP_BACKOFF_S);
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
  /** Total file duration in seconds. Used together with `hasNextEpisode`
   *  to synthesize a "Next Episode" credits-equivalent segment for the
   *  final SYNTH_CREDITS_WINDOW seconds when Plex provided no credits
   *  marker AND no credits-tagged chapter — common for episodes that the
   *  server's intro/credits detection partially missed. */
  duration: number = 0,
  /** True if a next queue item / episode-nav target exists. Required to
   *  enable the synthetic-credits fallback (the synthetic segment only
   *  ever surfaces as "Next Episode" — never as Skip Credits — because
   *  without a real credits marker we don't know where the credits
   *  actually start, only where the file ends). */
  hasNextEpisode: boolean = false,
  /** Per-show estimated credits-window length in ms (median of sibling
   *  episodes that DO have credits markers). Overrides
   *  DEFAULT_SYNTH_CREDITS_WINDOW_MS for the synthetic segment when
   *  provided — usually a more accurate fit than the 90s blanket default. */
  synthCreditsWindowMs?: number | null,
): SkipSegmentsResult {
  const [activeSegment, setActiveSegment] = useState<ActiveSegment | null>(null);
  const prevActiveRef = useRef<string | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());

  // Build segment list from markers (preferred) or chapters (fallback).
  // Then synthesize a "Next Episode" credits-equivalent for the last
  // SYNTH_CREDITS_WINDOW_MS of the file IF: (a) we know the duration,
  // (b) there's a next episode to advance to, and (c) no real credits
  // segment already exists for this episode. The synthetic segment is
  // tagged with startMs = -1 in dismissedRef so users can dismiss it
  // independently of any actual credits marker that might appear later.
  const baseSegments = useSegments(markers, chapters);
  const segments = useMemo(() => {
    const haveCredits = baseSegments.some((s) => s.type === "credits");
    const durationMs = duration * 1000;
    const windowMs =
      synthCreditsWindowMs && synthCreditsWindowMs > 0
        ? synthCreditsWindowMs
        : DEFAULT_SYNTH_CREDITS_WINDOW_MS;
    const canSynth =
      hasNextEpisode && !haveCredits && durationMs > windowMs;
    if (!canSynth) return baseSegments;
    return [
      ...baseSegments,
      {
        type: "credits" as const,
        startMs: durationMs - windowMs,
        endMs: durationMs,
      },
    ];
  }, [baseSegments, duration, hasNextEpisode, synthCreditsWindowMs]);

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

  // Combine markers + chapters per type. Plex's intro/credits Markers are
  // authoritative (server-side detection, often Plex Pass-only). For any
  // type the markers don't cover, fall back to chapter tags so an episode
  // that only got an intro marker (a common Plex data quirk) still shows
  // a Skip Credits / Next Episode button when the file has chapter tags
  // like "End Credits" / "Outro".
  const fromMarkers: SegmentRange[] = markers.map((m) => ({
    type: m.type,
    startMs: m.startTimeOffset,
    endMs: m.endTimeOffset,
  }));
  const haveIntroMarker = fromMarkers.some((s) => s.type === "intro");
  const haveCreditsMarker = fromMarkers.some((s) => s.type === "credits");

  const fromChapters: SegmentRange[] = chapters
    .map((ch) => {
      const tag = ch.tag.toLowerCase();
      const isIntro = tag.includes("intro") || tag.includes("opening");
      const isCredits =
        tag.includes("credits") ||
        tag.includes("outro") ||
        tag.includes("ending");
      if (!isIntro && !isCredits) return null;
      return {
        type: isIntro ? ("intro" as const) : ("credits" as const),
        startMs: ch.startTimeOffset,
        endMs: ch.endTimeOffset,
      };
    })
    .filter((s): s is SegmentRange =>
      s != null &&
      ((s.type === "intro" && !haveIntroMarker) ||
        (s.type === "credits" && !haveCreditsMarker)),
    );

  const result = [...fromMarkers, ...fromChapters];

  cacheRef.current = { markers, chapters, result };
  return result;
}
