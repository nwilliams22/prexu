/**
 * Plex timeline/scrobble reporting at regular intervals.
 * Reports playback progress to the Plex server so it can track watch state.
 */

import { useRef, useCallback } from "react";
import {
  reportTimeline,
  reportTimelineBeacon,
} from "../../services/plex-playback";

const TIMELINE_INTERVAL_MS = 10_000;

export interface TimelineReportingResult {
  /** Start periodic timeline reporting */
  startTimeline: () => void;
  /** Stop periodic timeline reporting */
  stopTimeline: () => void;
  /** Send a final "stopped" beacon (for unmount, uses sendBeacon) */
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
    if (server && durationRef.current > 0) {
      reportTimelineBeacon(
        server.uri,
        server.accessToken,
        ratingKeyRef.current,
        currentTimeRef.current * 1000,
        durationRef.current * 1000,
      );
    }
  }, [server]);

  return {
    startTimeline,
    stopTimeline,
    reportStopped,
    currentTimeRef,
    durationRef,
    isPlayingRef,
    ratingKeyRef,
  };
}
