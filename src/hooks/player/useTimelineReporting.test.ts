import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTimelineReporting } from "./useTimelineReporting";

vi.mock("../../services/plex-playback", () => ({
  reportTimeline: vi.fn().mockResolvedValue(undefined),
  reportTimelineBeacon: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/plex-library", () => ({
  markAsUnwatched: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
  },
}));

import { reportTimeline, reportTimelineBeacon } from "../../services/plex-playback";
import { markAsUnwatched } from "../../services/plex-library";
import { onWatchStateChanged } from "../../services/watch-state-events";

const SERVER = { uri: "https://server:32400", accessToken: "tok" };

function setup(server = SERVER) {
  const { result } = renderHook(() => useTimelineReporting(server));
  return result;
}

describe("useTimelineReporting.reportStopped", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears the resume marker (unscrobble) when stopped under 60s", () => {
    const result = setup();
    act(() => {
      result.current.ratingKeyRef.current = "66324";
      result.current.durationRef.current = 1244; // seconds
      result.current.currentTimeRef.current = 3.17; // 3.17s < 60s
      result.current.reportStopped();
    });
    expect(markAsUnwatched).toHaveBeenCalledWith(
      SERVER.uri,
      SERVER.accessToken,
      "66324",
    );
    expect(reportTimelineBeacon).not.toHaveBeenCalled();
  });

  it("ends the Now Playing session with a stopped report when stopped under 60s (prexu-9cj5)", () => {
    const result = setup();
    act(() => {
      result.current.ratingKeyRef.current = "66324";
      result.current.durationRef.current = 1244; // seconds
      result.current.currentTimeRef.current = 3.17; // 3.17s < 60s
      result.current.reportStopped();
    });
    // unscrobble alone does not end the server session — a state=stopped
    // timeline report must also fire, else Now Playing lingers until the
    // Plex idle timeout.
    expect(reportTimeline).toHaveBeenCalledWith(
      SERVER.uri,
      SERVER.accessToken,
      "66324",
      "stopped",
      3_170,
      1_244_000,
    );
  });

  it("clears at the boundary just under 60s", () => {
    const result = setup();
    act(() => {
      result.current.ratingKeyRef.current = "1";
      result.current.durationRef.current = 600;
      result.current.currentTimeRef.current = 59.9;
      result.current.reportStopped();
    });
    expect(markAsUnwatched).toHaveBeenCalledTimes(1);
    expect(reportTimelineBeacon).not.toHaveBeenCalled();
  });

  it("records the resume offset via beacon when stopped at/after 60s", () => {
    const result = setup();
    act(() => {
      result.current.ratingKeyRef.current = "66324";
      result.current.durationRef.current = 1244;
      result.current.currentTimeRef.current = 188; // 3:08, well past threshold
      result.current.reportStopped();
    });
    expect(reportTimelineBeacon).toHaveBeenCalledWith(
      SERVER.uri,
      SERVER.accessToken,
      "66324",
      188_000,
      1_244_000,
    );
    expect(markAsUnwatched).not.toHaveBeenCalled();
  });

  it("does nothing when duration is unknown (0)", () => {
    const result = setup();
    act(() => {
      result.current.ratingKeyRef.current = "x";
      result.current.durationRef.current = 0;
      result.current.currentTimeRef.current = 5;
      result.current.reportStopped();
    });
    expect(markAsUnwatched).not.toHaveBeenCalled();
    expect(reportTimelineBeacon).not.toHaveBeenCalled();
  });

  it("emits a watch-state-changed event carrying the ratingKey after an early-stop clear (prexu-lz4t)", async () => {
    const handler = vi.fn();
    const off = onWatchStateChanged(handler);
    const result = setup();
    act(() => {
      result.current.ratingKeyRef.current = "66324";
      result.current.durationRef.current = 1244;
      result.current.currentTimeRef.current = 3.17;
      result.current.reportStopped();
    });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    // The ratingKey is included so listeners (item-detail cache
    // invalidation) can target just this item instead of sweeping every
    // cached entry.
    expect(handler).toHaveBeenCalledWith("66324");
    off();
  });

  it("emits a watch-state-changed event carrying the ratingKey after a resume-offset beacon (prexu-lz4t)", async () => {
    const handler = vi.fn();
    const off = onWatchStateChanged(handler);
    const result = setup();
    act(() => {
      result.current.ratingKeyRef.current = "66324";
      result.current.durationRef.current = 1244;
      result.current.currentTimeRef.current = 90; // > 60s threshold
      result.current.reportStopped();
    });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(handler).toHaveBeenCalledWith("66324");
    off();
  });

  // prexu-ix52: reportTimelineBeacon now rejects on a non-2xx PMS response
  // (see plex-playback.ts). The stopped-beacon branch here must let that
  // rejection reach its `.catch()` — NOT fire emitWatchStateChanged() — so a
  // failed write never gets treated as "the dashboard can trust the new
  // offset now."
  it("does NOT emit watch-state-changed when the stopped beacon rejects", async () => {
    const handler = vi.fn();
    const off = onWatchStateChanged(handler);
    vi.mocked(reportTimelineBeacon).mockRejectedValueOnce(
      new Error("reportTimelineBeacon failed: 500 Internal Server Error"),
    );
    const result = setup();
    act(() => {
      result.current.ratingKeyRef.current = "66324";
      result.current.durationRef.current = 1244;
      result.current.currentTimeRef.current = 90; // > 60s threshold
      result.current.reportStopped();
    });
    await vi.waitFor(() =>
      expect(vi.mocked(reportTimelineBeacon)).toHaveBeenCalledTimes(1),
    );
    // Give the rejected promise's .catch() a tick to run.
    await Promise.resolve();
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it("does nothing when there is no server", () => {
    const result = setup(null);
    act(() => {
      result.current.durationRef.current = 600;
      result.current.currentTimeRef.current = 5;
      result.current.reportStopped();
    });
    expect(markAsUnwatched).not.toHaveBeenCalled();
    expect(reportTimelineBeacon).not.toHaveBeenCalled();
  });
});
