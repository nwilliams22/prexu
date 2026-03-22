import type { SubtitleStylePreferences } from "../types/preferences";

/**
 * Generate a CSS string with ::cue rules for styling video subtitles.
 * This applies to WebVTT/native text tracks rendered by the browser.
 */
export function buildSubtitleCss(style: SubtitleStylePreferences): string {
  const bgR = parseInt(style.backgroundColor.slice(1, 3), 16);
  const bgG = parseInt(style.backgroundColor.slice(3, 5), 16);
  const bgB = parseInt(style.backgroundColor.slice(5, 7), 16);
  const bgRgba = `rgba(${bgR}, ${bgG}, ${bgB}, ${style.backgroundOpacity})`;

  const outlineParts: string[] = [];
  if (style.outlineWidth > 0) {
    const w = style.outlineWidth;
    const c = style.outlineColor;
    // Create text-stroke-like effect using text-shadow offsets
    outlineParts.push(
      `${w}px ${w}px 0 ${c}`,
      `-${w}px -${w}px 0 ${c}`,
      `${w}px -${w}px 0 ${c}`,
      `-${w}px ${w}px 0 ${c}`,
    );
  }
  if (style.shadowEnabled) {
    outlineParts.push("2px 3px 4px rgba(0, 0, 0, 0.7)");
  }

  const textShadow = outlineParts.length > 0
    ? `text-shadow: ${outlineParts.join(", ")};`
    : "";

  return `
video::cue {
  font-family: ${style.fontFamily};
  color: ${style.textColor};
  background-color: ${bgRgba};
  ${textShadow}
}
`.trim();
}
