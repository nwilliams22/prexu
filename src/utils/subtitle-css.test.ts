import { describe, it, expect } from "vitest";
import { buildSubtitleCss } from "./subtitle-css";
import type { SubtitleStylePreferences } from "../types/preferences";

const defaults: SubtitleStylePreferences = {
  fontFamily: "sans-serif",
  textColor: "#FFFFFF",
  backgroundColor: "#000000",
  backgroundOpacity: 0.75,
  outlineColor: "#000000",
  outlineWidth: 2,
  shadowEnabled: true,
};

describe("buildSubtitleCss", () => {
  it("generates valid ::cue CSS with default settings", () => {
    const css = buildSubtitleCss(defaults);
    expect(css).toContain("video::cue {");
    expect(css).toContain("font-family: sans-serif");
    expect(css).toContain("color: #FFFFFF");
    expect(css).toContain("background-color: rgba(0, 0, 0, 0.75)");
    expect(css).toContain("text-shadow:");
  });

  it("includes outline shadow offsets", () => {
    const css = buildSubtitleCss(defaults);
    expect(css).toContain("2px 2px 0 #000000");
    expect(css).toContain("-2px -2px 0 #000000");
  });

  it("includes drop shadow when enabled", () => {
    const css = buildSubtitleCss(defaults);
    expect(css).toContain("2px 3px 4px rgba(0, 0, 0, 0.7)");
  });

  it("omits text-shadow when outline is 0 and shadow disabled", () => {
    const css = buildSubtitleCss({
      ...defaults,
      outlineWidth: 0,
      shadowEnabled: false,
    });
    expect(css).not.toContain("text-shadow:");
  });

  it("uses custom font family", () => {
    const css = buildSubtitleCss({
      ...defaults,
      fontFamily: "'Courier New', monospace",
    });
    expect(css).toContain("font-family: 'Courier New', monospace");
  });

  it("handles fully transparent background", () => {
    const css = buildSubtitleCss({
      ...defaults,
      backgroundOpacity: 0,
    });
    expect(css).toContain("rgba(0, 0, 0, 0)");
  });

  it("handles colored background", () => {
    const css = buildSubtitleCss({
      ...defaults,
      backgroundColor: "#FF0000",
      backgroundOpacity: 0.5,
    });
    expect(css).toContain("rgba(255, 0, 0, 0.5)");
  });
});
