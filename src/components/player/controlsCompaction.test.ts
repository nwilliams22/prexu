import { describe, it, expect } from "vitest";
import {
  computeControlsCompaction,
  CONTROLS_BREAKPOINTS,
} from "./controlsCompaction";

describe("computeControlsCompaction (prexu-52ky)", () => {
  it("treats an unmeasured width (<= 0) as full width — no compaction", () => {
    expect(computeControlsCompaction(0)).toEqual({
      iconCompact: false,
      rightOverflow: false,
      hideSubtitlesInline: false,
      hideTransportExtras: false,
    });
    expect(computeControlsCompaction(-1)).toEqual({
      iconCompact: false,
      rightOverflow: false,
      hideSubtitlesInline: false,
      hideTransportExtras: false,
    });
  });

  it("~920px (hardware popout physical width): no compaction at all", () => {
    expect(computeControlsCompaction(920)).toEqual({
      iconCompact: false,
      rightOverflow: false,
      hideSubtitlesInline: false,
      hideTransportExtras: false,
    });
  });

  it("~530px (hardware popout logical width — the reported bug size): icons shrink and the right cluster's secondary buttons overflow, but subtitles/transport stay inline", () => {
    expect(computeControlsCompaction(530)).toEqual({
      iconCompact: true,
      rightOverflow: true,
      hideSubtitlesInline: false,
      hideTransportExtras: false,
    });
  });

  it("~320px: transport extras (episode/chapter nav) also drop", () => {
    expect(computeControlsCompaction(320)).toEqual({
      iconCompact: true,
      rightOverflow: true,
      hideSubtitlesInline: false,
      hideTransportExtras: true,
    });
  });

  it("200px (logical floor): every tier is active — subtitles also collapses into overflow", () => {
    expect(computeControlsCompaction(200)).toEqual({
      iconCompact: true,
      rightOverflow: true,
      hideSubtitlesInline: true,
      hideTransportExtras: true,
    });
  });

  it("pop-out and fullscreen have no corresponding flag — they are never collapsible by design", () => {
    // There is intentionally no "hidePopout" or "hideFullscreen" field —
    // callers must keep those two unconditionally inline at every width.
    const allWidths = [920, 530, 320, 200, 1, 5000];
    for (const w of allWidths) {
      const level = computeControlsCompaction(w);
      expect(Object.keys(level).sort()).toEqual(
        [
          "hideSubtitlesInline",
          "hideTransportExtras",
          "iconCompact",
          "rightOverflow",
        ].sort(),
      );
    }
  });

  it("boundaries are exclusive on the upper edge (width === threshold is NOT compacted)", () => {
    expect(computeControlsCompaction(CONTROLS_BREAKPOINTS.iconCompact).iconCompact).toBe(false);
    expect(computeControlsCompaction(CONTROLS_BREAKPOINTS.iconCompact - 1).iconCompact).toBe(true);

    expect(computeControlsCompaction(CONTROLS_BREAKPOINTS.rightOverflow).rightOverflow).toBe(false);
    expect(computeControlsCompaction(CONTROLS_BREAKPOINTS.rightOverflow - 1).rightOverflow).toBe(true);

    expect(computeControlsCompaction(CONTROLS_BREAKPOINTS.hideSubtitlesInline).hideSubtitlesInline).toBe(false);
    expect(computeControlsCompaction(CONTROLS_BREAKPOINTS.hideSubtitlesInline - 1).hideSubtitlesInline).toBe(true);

    expect(computeControlsCompaction(CONTROLS_BREAKPOINTS.hideTransportExtras).hideTransportExtras).toBe(false);
    expect(computeControlsCompaction(CONTROLS_BREAKPOINTS.hideTransportExtras - 1).hideTransportExtras).toBe(true);
  });

  it("tiers are monotonic — a lower width never un-compacts a tier that a higher width already triggered", () => {
    const widths = [1000, 900, 800, 700, 600, 560, 530, 460, 420, 400, 320, 300, 260, 200, 100, 1];
    let prev = computeControlsCompaction(widths[0]);
    for (let i = 1; i < widths.length; i++) {
      const cur = computeControlsCompaction(widths[i]);
      expect(cur.iconCompact || !prev.iconCompact).toBe(true);
      expect(cur.rightOverflow || !prev.rightOverflow).toBe(true);
      expect(cur.hideSubtitlesInline || !prev.hideSubtitlesInline).toBe(true);
      expect(cur.hideTransportExtras || !prev.hideTransportExtras).toBe(true);
      prev = cur;
    }
  });
});
