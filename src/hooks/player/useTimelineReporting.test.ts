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

import { reportTimelineBeacon } from "../../services/plex-playback";
import { markAsUnwatched } from "../../services/plex-library";

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
