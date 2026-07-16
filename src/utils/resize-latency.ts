/**
 * Page-side resize-latency tracker (prexu-41cw investigation item 2, built
 * for the prexu-ertt Phase 2 decision matrix).
 *
 * WebKitGTK's layout viewport lags the OS window during large drag-resizes
 * (the ~2s black-gap class), and under direction reversals it visibly paints
 * STALE sizes (queued relayouts are not coalesced to the newest size). This
 * tracker turns both into numbers:
 *
 * - `onResizeEvent(width)` — the authoritative new viewport width, fed from
 *   Tauri's `window://resized` payload (the browser's own `innerWidth` is
 *   itself the laggy layout viewport, so it cannot be the target).
 * - `onLayoutObserved(width)` — what WebKit actually laid out, fed from a
 *   ResizeObserver on `document.documentElement`.
 * - `summarize()` — per-burst stats, logged at the resize gate's trailing
 *   edge and then reset for the next burst.
 *
 * `staleObservations` counts layouts committed at a width that is no longer
 * the current target — a direct measurement of the direction-reversal
 * stale-paint signature.
 */
export interface ResizeBurstSummary {
  /** Resize events (target-size changes) in the burst. */
  events: number;
  /** documentElement layouts observed during the burst. */
  layoutObservations: number;
  /** Layouts at a width that was no longer the current target (stale). */
  staleObservations: number;
  /** Worst target-set → matching-layout latency seen in the burst (ms). */
  maxCatchupLagMs: number;
  /** Latency of the most recent catch-up (ms); -1 if layout never caught up. */
  lastCatchupLagMs: number;
  /** Whether layout matched the final target before the burst settled. */
  caughtUp: boolean;
}

/** documentElement width may differ from the viewport by a scrollbar-ish
 *  sliver; anything within this many CSS px counts as "caught up". */
const WIDTH_TOLERANCE_PX = 2;

export function createResizeLatencyTracker(now: () => number) {
  let events = 0;
  let layoutObservations = 0;
  let staleObservations = 0;
  let maxCatchupLagMs = 0;
  let lastCatchupLagMs = -1;
  let caughtUp = false;
  let lastEventAt = 0;
  let targetWidth = -1;

  const onResizeEvent = (width: number) => {
    events++;
    lastEventAt = now();
    targetWidth = width;
    caughtUp = false;
  };

  /**
   * Returns the LATE catch-up lag (ms) when this observation is the layout
   * finally matching the target AFTER the burst was summarized — the 41cw
   * headline number (measured on-hardware: WebKit commits almost no layouts
   * mid-drag, so the catch-up almost always lands after the settle window).
   * Returns null for every in-burst or non-matching observation.
   */
  const onLayoutObserved = (width: number): number | null => {
    if (events === 0) {
      // Post-summarize: the target stays armed until the layout reaches it,
      // so the late catch-up is measured instead of discarded. Unrelated
      // content-driven documentElement resizes (no armed target) are not
      // ours and stay ignored.
      if (targetWidth >= 0 && Math.abs(width - targetWidth) <= WIDTH_TOLERANCE_PX) {
        targetWidth = -1;
        return now() - lastEventAt;
      }
      return null;
    }
    layoutObservations++;
    if (Math.abs(width - targetWidth) <= WIDTH_TOLERANCE_PX) {
      const lag = now() - lastEventAt;
      lastCatchupLagMs = lag;
      if (lag > maxCatchupLagMs) maxCatchupLagMs = lag;
      caughtUp = true;
    } else {
      staleObservations++;
    }
    return null;
  };

  const summarize = (): ResizeBurstSummary => {
    const summary: ResizeBurstSummary = {
      events,
      layoutObservations,
      staleObservations,
      maxCatchupLagMs: Math.round(maxCatchupLagMs),
      lastCatchupLagMs: lastCatchupLagMs < 0 ? -1 : Math.round(lastCatchupLagMs),
      caughtUp,
    };
    events = 0;
    layoutObservations = 0;
    staleObservations = 0;
    maxCatchupLagMs = 0;
    lastCatchupLagMs = -1;
    // The target (and its event timestamp) deliberately survive the reset
    // when the burst never caught up — see onLayoutObserved's late-catch-up
    // path. A caught-up burst disarms so unrelated later layouts are ignored.
    if (caughtUp) {
      targetWidth = -1;
    }
    caughtUp = false;
    return summary;
  };

  return { onResizeEvent, onLayoutObserved, summarize };
}
