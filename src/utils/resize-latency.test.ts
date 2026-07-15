import { describe, it, expect } from "vitest";
import { createResizeLatencyTracker } from "./resize-latency";

describe("createResizeLatencyTracker", () => {
  const makeClock = () => {
    let t = 0;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it("measures event→matching-layout catch-up lag", () => {
    const clock = makeClock();
    const tracker = createResizeLatencyTracker(clock.now);
    tracker.onResizeEvent(1000);
    clock.advance(1800);
    tracker.onLayoutObserved(1000);
    const s = tracker.summarize();
    expect(s.maxCatchupLagMs).toBe(1800);
    expect(s.lastCatchupLagMs).toBe(1800);
    expect(s.caughtUp).toBe(true);
    expect(s.staleObservations).toBe(0);
  });

  it("counts stale layouts — the direction-reversal signature", () => {
    const clock = makeClock();
    const tracker = createResizeLatencyTracker(clock.now);
    tracker.onResizeEvent(1600); // dragged right...
    clock.advance(50);
    tracker.onResizeEvent(1000); // ...snapped left: target is now 1000
    clock.advance(500);
    tracker.onLayoutObserved(1600); // WebKit paints the OLD extent
    clock.advance(500);
    tracker.onLayoutObserved(1000); // then the correct one
    const s = tracker.summarize();
    expect(s.staleObservations).toBe(1);
    expect(s.layoutObservations).toBe(2);
    expect(s.lastCatchupLagMs).toBe(1000);
    expect(s.caughtUp).toBe(true);
  });

  it("reports a burst that never caught up", () => {
    const clock = makeClock();
    const tracker = createResizeLatencyTracker(clock.now);
    tracker.onResizeEvent(2000);
    clock.advance(150);
    tracker.onLayoutObserved(1200);
    const s = tracker.summarize();
    expect(s.caughtUp).toBe(false);
    expect(s.lastCatchupLagMs).toBe(-1);
    expect(s.staleObservations).toBe(1);
  });

  it("tolerates scrollbar-sliver width differences", () => {
    const clock = makeClock();
    const tracker = createResizeLatencyTracker(clock.now);
    tracker.onResizeEvent(1000);
    clock.advance(20);
    tracker.onLayoutObserved(998); // within 2px tolerance
    expect(tracker.summarize().caughtUp).toBe(true);
  });

  it("ignores layouts outside a burst and resets after summarize", () => {
    const clock = makeClock();
    const tracker = createResizeLatencyTracker(clock.now);
    tracker.onLayoutObserved(1000); // no burst → ignored
    expect(tracker.summarize().layoutObservations).toBe(0);
    tracker.onResizeEvent(800);
    clock.advance(10);
    tracker.onLayoutObserved(800);
    tracker.summarize();
    // fully reset: a lone stale layout after reset is ignored again
    tracker.onLayoutObserved(800);
    expect(tracker.summarize().layoutObservations).toBe(0);
  });
});
