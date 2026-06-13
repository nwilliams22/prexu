import { describe, it, expect, vi } from "vitest";
import { emitWatchStateChanged, onWatchStateChanged } from "./watch-state-events";

describe("watch-state-events", () => {
  it("invokes a subscribed handler on emit", () => {
    const handler = vi.fn();
    const off = onWatchStateChanged(handler);
    emitWatchStateChanged();
    expect(handler).toHaveBeenCalledTimes(1);
    off();
  });

  it("stops invoking after unsubscribe", () => {
    const handler = vi.fn();
    const off = onWatchStateChanged(handler);
    off();
    emitWatchStateChanged();
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports multiple independent subscribers", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onWatchStateChanged(a);
    const offB = onWatchStateChanged(b);
    emitWatchStateChanged();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });
});
