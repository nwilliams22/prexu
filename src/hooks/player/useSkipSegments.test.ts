import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSkipSegments } from "./useSkipSegments";
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
