import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLeadingTrailingGate } from "./resize-tick";

describe("createLeadingTrailingGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires leading immediately on the first poke of a burst", () => {
    const fire = vi.fn();
    const gate = createLeadingTrailingGate(150, fire);
    gate.poke();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith("leading");
  });

  it("suppresses mid-burst pokes — a 60fps drag causes exactly two fires", () => {
    const fire = vi.fn();
    const gate = createLeadingTrailingGate(150, fire);
    // Simulate a 2-second drag at ~60fps (pokes every 16ms).
    for (let i = 0; i < 125; i++) {
      gate.poke();
      vi.advanceTimersByTime(16);
    }
    expect(fire).toHaveBeenCalledTimes(1); // leading only, so far
    vi.advanceTimersByTime(150);
    expect(fire).toHaveBeenCalledTimes(2);
    expect(fire).toHaveBeenLastCalledWith("trailing");
  });

  it("starts a new burst (leading again) after settle", () => {
    const fire = vi.fn();
    const gate = createLeadingTrailingGate(150, fire);
    gate.poke();
    vi.advanceTimersByTime(150); // trailing fires
    gate.poke();
    expect(fire).toHaveBeenCalledTimes(3);
    expect(fire).toHaveBeenLastCalledWith("leading");
  });

  it("dispose cancels the pending trailing fire", () => {
    const fire = vi.fn();
    const gate = createLeadingTrailingGate(150, fire);
    gate.poke();
    gate.dispose();
    vi.advanceTimersByTime(1000);
    expect(fire).toHaveBeenCalledTimes(1); // leading only — no orphaned trailing
  });

  it("trailing resets while pokes keep arriving inside the settle window", () => {
    const fire = vi.fn();
    const gate = createLeadingTrailingGate(150, fire);
    gate.poke();
    vi.advanceTimersByTime(100);
    gate.poke(); // 100ms in — resets the settle timer
    vi.advanceTimersByTime(100);
    expect(fire).toHaveBeenCalledTimes(1); // 200ms total but never 150ms quiet
    vi.advanceTimersByTime(50);
    expect(fire).toHaveBeenCalledTimes(2); // now 150ms quiet → trailing
  });
});
