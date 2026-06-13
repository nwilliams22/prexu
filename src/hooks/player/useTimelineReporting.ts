/**
 * Plex timeline/scrobble reporting at regular intervals.
 * Reports playback progress to the Plex server so it can track watch state.
 */

import { useRef, useCallback, useMemo } from "react";
import {
  reportTimeline,
  reportTimelineBeacon,
} from "../../services/plex-playback";
import { markAsUnwatched } from "../../services/plex-library";
import { emitWatchStateChanged } from "../../services/watch-state-events";
import { logger } from "../../services/logger";

const TIMELINE_INTERVAL_MS = 10_000;

/**
 * Stops below this watched position are treated as "didn't really start it":
 * the resume marker is cleared via /:/unscrobble rather than recording a tiny
 * resume offset. Matches Plex's own ~60s minimum-progress convention.
 */
const RESUME_CLEAR_THRESHOLD_MS = 60_000;

export interface TimelineReportingResult {
  /** Start periodic timeline reporting */
  startTimeline: () => void;
  /** Stop periodic timeline reporting */
  stopTimeline: () => void;
  /**
   * Final stop report on player exit/unmount. Below 60s watched it clears the
   * resume marker (/:/unscrobble); past 60s it records the resume offset via a
   * stopped timeline beacon. Fire-and-forget but logs delivery.
   */
  reportStopped: () => void;
  /** Refs to keep in sync with current playback state */
  currentTimeRef: React.MutableRefObject<number>;
  durationRef: React.MutableRefObject<number>;
  isPlayingRef: React.MutableRefObject<boolean>;
  ratingKeyRef: React.MutableRefObject<string>;
}

export function useTimelineReporting(
  server: { uri: string; accessToken: string } | null,
): TimelineReportingResult {
  const timelineRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);
  const ratingKeyRef = useRef("");

  const startTimeline = useCallback(() => {
    if (timelineRef.current) clearInterval(timelineRef.current);
    if (!server) return;

    timelineRef.current = setInterval(() => {
      if (isPlayingRef.current) {
        reportTimeline(
          server.uri,
          server.accessToken,
          ratingKeyRef.current,
          "playing",
          currentTimeRef.current * 1000,
          durationRef.current * 1000,
        );
      }
    }, TIMELINE_INTERVAL_MS);
  }, [server]);

  const stopTimeline = useCallback(() => {
    if (timelineRef.current) {
      clearInterval(timelineRef.current);
      timelineRef.current = null;
    }
  }, []);

  const reportStopped = useCallback(() => {
    if (!server || durationRef.current <= 0) return;
    const ratingKey = ratingKeyRef.current;
    const timeMs = currentTimeRef.current * 1000;

    if (timeMs < RESUME_CLEAR_THRESHOLD_MS) {
      // Early stop: deterministically clear the resume marker via
      // /:/unscrobble. Relying on Plex to implicitly drop the marker for a
      // `state=stopped` beacon with time < 60s does NOT work when a prior
      // resume point already exists — the old offset (e.g. 3:08) survives.
      logger.info("playback", "early stop (<60s) — clearing resume marker", {
        ratingKey,
        timeMs: Math.round(timeMs),
      });
      const { uri, accessToken } = server;
      markAsUnwatched(uri, accessToken, ratingKey)
        .then(() => {
          logger.info("playback", "resume marker cleared (unscrobble ok)", {
            ratingKey,
          });
          // Server state is now updated — refresh the dashboard's Continue
          // Watching shelf (it's an overlay sibling that never remounts, so it
          // won't refetch on its own).
          emitWatchStateChanged();
        })
        .catch((err) =>
          logger.warn("playback", "unscrobble failed", {
            ratingKey,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return;
    }

    // Past the threshold: record the real resume offset. Log delivery so a
    // dropped report is visible (it previously failed silently).
    reportTimelineBeacon(
      server.uri,
      server.accessToken,
      ratingKey,
      timeMs,
      durationRef.current * 1000,
    )
      .then(() => {
        logger.info("playback", "stopped beacon delivered", {
          ratingKey,
          timeMs: Math.round(timeMs),
        });
        // New resume offset recorded — refresh Continue Watching so the shelf
        // reflects the updated progress.
        emitWatchStateChanged();
      })
      .catch((err) =>
        logger.warn("playback", "stopped beacon failed", {
          ratingKey,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  }, [server]);

  return useMemo(
    () => ({
      startTimeline,
      stopTimeline,
      reportStopped,
      currentTimeRef,
      durationRef,
      isPlayingRef,
      ratingKeyRef,
    }),
    [startTimeline, stopTimeline, reportStopped],
  );
}
