/**
 * Pure width-to-compaction-level mapping for the bottom controls bar
 * (prexu-52ky).
 *
 * Root cause (diagnosed in PR #68, PopoutExitButton docblock): the right
 * button cluster (subtitles, audio, enhancements, queue, minimize, pop-out,
 * fullscreen) and the left transport cluster (SkipButtons) are plain flex
 * rows with no wrap and no width-based compaction. Their combined
 * min-content width (~500px+) exceeds even the DEFAULT pop-out size
 * (480x270), so items overflow past the visible window edge instead of
 * shrinking — the pop-out toggle itself sits in the trailing group, so once
 * squeezed off-screen there was no way back short of resizing the window.
 *
 * This module has no React/DOM dependency so the threshold logic can be
 * exhaustively unit tested without mounting anything or mocking
 * ResizeObserver. ControlsBottomBar measures its own row width (real
 * ResizeObserver in the app, a mocked one in its integration tests) and
 * feeds it through `computeControlsCompaction`.
 */

export interface ControlsCompaction {
  /** Shrink icon size/padding across both clusters to reclaim horizontal
   *  room before resorting to hiding anything. */
  iconCompact: boolean;
  /** Collapse the right cluster's secondary buttons (audio, audio
   *  enhancements, queue, minimize) into the overflow "more" menu.
   *  Subtitles/pop-out/fullscreen stay inline. */
  rightOverflow: boolean;
  /** Also collapse the subtitles button into the overflow menu, leaving
   *  only pop-out + fullscreen + the "more" button pinned inline. Pop-out
   *  and fullscreen are NEVER collapsed — pop-out is the primary action in
   *  pop-out mode and must always be reachable in the row. */
  hideSubtitlesInline: boolean;
  /** Drop the transport row's prev/next-episode and prev/next-chapter
   *  ("next/prev chapter style extras") buttons, leaving stop / 10s-skip /
   *  play-pause. Play/pause and stop are NEVER hidden regardless of width. */
  hideTransportExtras: boolean;
}

/**
 * Row-width thresholds (logical px) at which each compaction tier kicks in.
 * Derived from the documented bug measurements — combined min-content width
 * ~500px+, default pop-out (480x270) already clipping, 200x120 logical
 * floor — with headroom for icon/gap shrinkage. Exact pixel boundaries are
 * a heuristic starting point; visually confirm on hardware if the row still
 * looks cramped right at a boundary.
 */
export const CONTROLS_BREAKPOINTS = {
  iconCompact: 700,
  rightOverflow: 560,
  hideSubtitlesInline: 300,
  hideTransportExtras: 420,
} as const;

/** Compute the compaction level for a measured controls-row width.
 *  `width <= 0` means "not measured yet" (first paint, before the
 *  ResizeObserver reports back) — treated as full width so the bar never
 *  flashes a compacted layout before it knows the real size. */
export function computeControlsCompaction(width: number): ControlsCompaction {
  if (width <= 0) {
    return {
      iconCompact: false,
      rightOverflow: false,
      hideSubtitlesInline: false,
      hideTransportExtras: false,
    };
  }
  return {
    iconCompact: width < CONTROLS_BREAKPOINTS.iconCompact,
    rightOverflow: width < CONTROLS_BREAKPOINTS.rightOverflow,
    hideSubtitlesInline: width < CONTROLS_BREAKPOINTS.hideSubtitlesInline,
    hideTransportExtras: width < CONTROLS_BREAKPOINTS.hideTransportExtras,
  };
}
