import { describe, it, expect } from "vitest";
import { estimateCreditsLengthMs } from "./useShowCreditsLength";
import type { PlexEpisode, PlexMarker } from "../../types/library";

function ep(
  duration: number,
  markers: { type: "intro" | "credits"; startTimeOffset: number; endTimeOffset?: number }[],
): PlexEpisode {
  return {
    duration,
    Marker: markers.map((m) => ({
      type: m.type,
      startTimeOffset: m.startTimeOffset,
      endTimeOffset: m.endTimeOffset ?? m.startTimeOffset + 1000,
    } as PlexMarker)),
  } as unknown as PlexEpisode;
}

describe("estimateCreditsLengthMs", () => {
  it("returns null when fewer than 3 episodes have credits markers", () => {
    expect(estimateCreditsLengthMs([])).toBeNull();
    expect(estimateCreditsLengthMs([ep(1000, [{ type: "credits", startTimeOffset: 950 }])])).toBeNull();
    expect(
      estimateCreditsLengthMs([
        ep(1000, [{ type: "credits", startTimeOffset: 950 }]),
        ep(1000, [{ type: "credits", startTimeOffset: 950 }]),
      ]),
    ).toBeNull();
  });

  it("computes the median across qualifying episodes (odd count)", () => {
    const eps = [
      ep(1000, [{ type: "credits", startTimeOffset: 940 }]), // len 60
      ep(1000, [{ type: "credits", startTimeOffset: 920 }]), // len 80
      ep(1000, [{ type: "credits", startTimeOffset: 900 }]), // len 100
    ];
    expect(estimateCreditsLengthMs(eps)).toBe(80);
  });

  it("computes the median (even count, averages the two middle values)", () => {
    const eps = [
      ep(1000, [{ type: "credits", startTimeOffset: 940 }]), // 60
      ep(1000, [{ type: "credits", startTimeOffset: 920 }]), // 80
      ep(1000, [{ type: "credits", startTimeOffset: 900 }]), // 100
      ep(1000, [{ type: "credits", startTimeOffset: 880 }]), // 120
    ];
    // sorted: 60, 80, 100, 120 → median = (80+100)/2 = 90
    expect(estimateCreditsLengthMs(eps)).toBe(90);
  });

  it("ignores intros and episodes without a credits marker", () => {
    const eps = [
      ep(1000, [{ type: "intro", startTimeOffset: 0 }]), // no credits — skipped
      ep(1000, [{ type: "credits", startTimeOffset: 940 }]), // 60
      ep(1000, [{ type: "credits", startTimeOffset: 920 }]), // 80
      ep(1000, [{ type: "credits", startTimeOffset: 900 }]), // 100
    ];
    expect(estimateCreditsLengthMs(eps)).toBe(80);
  });

  it("uses the EARLIEST credits marker when an episode has multiple", () => {
    const eps = [
      ep(1000, [
        { type: "credits", startTimeOffset: 950 }, // earliest
        { type: "credits", startTimeOffset: 970 },
      ]), // len based on 950 → 50
      ep(1000, [{ type: "credits", startTimeOffset: 920 }]), // 80
      ep(1000, [{ type: "credits", startTimeOffset: 900 }]), // 100
    ];
    expect(estimateCreditsLengthMs(eps)).toBe(80); // sorted: 50, 80, 100
  });

  it("skips episodes with zero duration", () => {
    const eps = [
      ep(0, [{ type: "credits", startTimeOffset: 0 }]), // skipped
      ep(1000, [{ type: "credits", startTimeOffset: 940 }]),
      ep(1000, [{ type: "credits", startTimeOffset: 920 }]),
      ep(1000, [{ type: "credits", startTimeOffset: 900 }]),
    ];
    expect(estimateCreditsLengthMs(eps)).toBe(80);
  });

  it("skips negative or zero credits-length results", () => {
    const eps = [
      // credits start AT or AFTER duration — Plex data error, skip
      ep(1000, [{ type: "credits", startTimeOffset: 1000 }]),
      ep(1000, [{ type: "credits", startTimeOffset: 1100 }]),
      ep(1000, [{ type: "credits", startTimeOffset: 940 }]),
      ep(1000, [{ type: "credits", startTimeOffset: 920 }]),
      ep(1000, [{ type: "credits", startTimeOffset: 900 }]),
    ];
    // qualifying lengths: 60, 80, 100 → median 80
    expect(estimateCreditsLengthMs(eps)).toBe(80);
  });
});
