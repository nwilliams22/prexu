import { describe, it, expect } from "vitest";
import { detailStyles } from "./detail-styles";

describe("detailStyles", () => {
  it("exports all expected style keys", () => {
    const expectedKeys = [
      "pageBgArt",
      "pageBgArtFallback",
      "pageBgOverlay",
      "heroContent",
      "heroPoster",
      "heroInfo",
      "heroTitle",
      "metaRow",
    ];
    for (const key of expectedKeys) {
      expect(detailStyles).toHaveProperty(key);
    }
  });

  it("includes responsive mobile and large variants", () => {
    const responsiveKeys = [
      "heroContentMobile",
      "heroPosterMobile",
      "heroTitleMobile",
      "metaRowMobile",
      "heroPosterLarge",
      "heroTitleLarge",
    ];
    for (const key of responsiveKeys) {
      expect(detailStyles).toHaveProperty(key);
    }
  });

  it("each value is a valid CSSProperties object", () => {
    for (const [key, value] of Object.entries(detailStyles)) {
      expect(typeof value).toBe("object");
      expect(value).not.toBeNull();
      expect(Array.isArray(value)).toBe(false);
      // Spot-check: every style object should have at least one property
      expect(Object.keys(value).length).toBeGreaterThan(0);
    }
  });
});
