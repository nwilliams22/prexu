import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSkipSegments, clampSkipTarget } from "./useSkipSegments";
import type { PlexMarker, PlexChapter } from "../../types/library";

const enabled = { intro: true, credits: true };

describe("useSkipSegments", () => {
  it("returns null when no markers or chapters", async () => {
    const { result } = renderHook(() =>
      useSkipSegments([], [], 30, enabled)
    );
    // No microtask needed since there's no segment to detect
    expect(result.current.activeSegment).toBeNull();
  });

  it("detects intro segment from markers", async () => {
    const markers: PlexMarker[] = [
      { id: 1, type: "intro", startTimeOffset: 5000, endTimeOffset: 60000 },
    ];
    const { result } = renderHook(() =>
      useSkipSegments(markers, [], 30, enabled)
    );
    await waitFor(() => {
      expect(result.current.activeSegment).toEqual({
        type: "intro",
        endTime: 60,
      });
    });
  });

  it("detects credits segment from markers", async () => {
    const markers: PlexMarker[] = [
      { id: 1, type: "intro", startTimeOffset: 5000, endTimeOffset: 60000 },
      { id: 2, type: "credits", startTimeOffset: 2400000, endTimeOffset: 2700000 },
    ];
    const { result } = renderHook(() =>
      useSkipSegments(markers, [], 2500, enabled)
    );
    await waitFor(() => {
      expect(result.current.activeSegment).toEqual({
        type: "credits",
        endTime: 2700,
      });
    });
  });

  it("returns null when not within any segment", () => {
    const markers: PlexMarker[] = [
      { id: 1, type: "intro", startTimeOffset: 5000, endTimeOffset: 60000 },
    ];
    const { result } = renderHook(() =>
      useSkipSegments(markers, [], 120, enabled)
    );
    expect(result.current.activeSegment).toBeNull();
  });

  it("falls back to chapter-based detection", async () => {
    const chapters: PlexChapter[] = [
      { id: 1, index: 0, tag: "Intro", startTimeOffset: 0, endTimeOffset: 45000 },
      { id: 2, index: 1, tag: "Main Content", startTimeOffset: 45000, endTimeOffset: 2400000 },
      { id: 3, index: 2, tag: "Credits", startTimeOffset: 2400000, endTimeOffset: 2700000 },
    ];
    const { result } = renderHook(() =>
      useSkipSegments([], chapters, 20, enabled)
    );
    await waitFor(() => {
      expect(result.current.activeSegment).toEqual({
        type: "intro",
        endTime: 45,
      });
    });
  });

  it("prefers markers over chapters when both present", async () => {
    const markers: PlexMarker[] = [
      { id: 1, type: "intro", startTimeOffset: 10000, endTimeOffset: 90000 },
    ];
    const chapters: PlexChapter[] = [
      { id: 1, index: 0, tag: "Intro", startTimeOffset: 0, endTimeOffset: 45000 },
    ];
    const { result } = renderHook(() =>
      useSkipSegments(markers, chapters, 50, enabled)
    );
    await waitFor(() => {
      expect(result.current.activeSegment).toEqual({
        type: "intro",
        endTime: 90,
      });
    });
  });

  it("respects disabled intro preference", () => {
    const markers: PlexMarker[] = [
      { id: 1, type: "intro", startTimeOffset: 5000, endTimeOffset: 60000 },
    ];
    const { result } = renderHook(() =>
      useSkipSegments(markers, [], 30, { intro: false, credits: true })
    );
    expect(result.current.activeSegment).toBeNull();
  });

  it("respects disabled credits preference", () => {
    const markers: PlexMarker[] = [
      { id: 1, type: "credits", startTimeOffset: 2400000, endTimeOffset: 2700000 },
    ];
    const { result } = renderHook(() =>
      useSkipSegments(markers, [], 2500, { intro: true, credits: false })
    );
    expect(result.current.activeSegment).toBeNull();
  });

  it("dismisses segment when dismissSegment is called", async () => {
    const markers: PlexMarker[] = [
      { id: 1, type: "intro", startTimeOffset: 5000, endTimeOffset: 60000 },
    ];
    const { result } = renderHook(() =>
      useSkipSegments(markers, [], 30, enabled)
    );
    await waitFor(() => {
      expect(result.current.activeSegment).not.toBeNull();
    });

    act(() => {
      result.current.dismissSegment();
    });

    expect(result.current.activeSegment).toBeNull();
  });
});

describe("clampSkipTarget (prexu-7fe.2)", () => {
  it("returns the target unchanged when target is well below duration", () => {
    expect(clampSkipTarget(60, 1421.42)).toBe(60);
  });

  it("clamps target equal to duration back to duration - 0.5s", () => {
    // Synthetic-credits case: activeSegment.endTime === player.duration.
    // Seeking exactly to duration parked mpv at EOF without emitting
    // eof-reached; clamping leaves a 0.5s tail to play through.
    expect(clampSkipTarget(1421.42, 1421.42)).toBeCloseTo(1420.92, 5);
  });

  it("clamps target within the 0.5s tail back to duration - 0.5s", () => {
    expect(clampSkipTarget(1421.2, 1421.42)).toBeCloseTo(1420.92, 5);
  });

  it("clamps target past duration back to duration - 0.5s", () => {
    expect(clampSkipTarget(1500, 1421.42)).toBeCloseTo(1420.92, 5);
  });

  it("returns target unchanged when duration is unknown (0)", () => {
    // duration=0 is the pre-FileLoaded state — no clamp basis.
    expect(clampSkipTarget(1421.42, 0)).toBe(1421.42);
  });

  it("returns target unchanged when duration is negative", () => {
    expect(clampSkipTarget(1421.42, -1)).toBe(1421.42);
  });

  it("never returns a negative target even with a tiny duration", () => {
    // Pathological: duration < EOF_CLAMP_BACKOFF_S. Don't seek to a
    // negative time — clamp the floor at 0.
    expect(clampSkipTarget(0.3, 0.3)).toBe(0);
  });
});
