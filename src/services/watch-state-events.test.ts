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

  // prexu-lz4t: the event now optionally carries the ratingKey of the item
  // whose watch state changed, so listeners (item-detail cache invalidation)
  // can target just that item instead of sweeping every cached entry.
  describe("ratingKey payload (prexu-lz4t)", () => {
    it("passes the ratingKey through to the handler when emitted with one", () => {
      const handler = vi.fn();
      const off = onWatchStateChanged(handler);
      emitWatchStateChanged("66324");
      expect(handler).toHaveBeenCalledWith("66324");
      off();
    });

    it("passes undefined when emitted without a ratingKey", () => {
      const handler = vi.fn();
      const off = onWatchStateChanged(handler);
      emitWatchStateChanged();
      expect(handler).toHaveBeenCalledWith(undefined);
      off();
    });

    it("is backward compatible with handlers that ignore the argument", () => {
      // Existing call sites (useDashboard's `() => refresh("deck")`,
      // cache-invalidators' original `() => {...}`) declare zero-arg
      // handlers. They must keep working unchanged when called with the
      // (ignored) ratingKey argument.
      let callCount = 0;
      const zeroArgHandler = () => {
        callCount += 1;
      };
      const off = onWatchStateChanged(zeroArgHandler);
      emitWatchStateChanged("66324");
      expect(callCount).toBe(1);
      off();
    });

    it("delivers independent ratingKeys to independent subscribers", () => {
      const a = vi.fn();
      const b = vi.fn();
      const offA = onWatchStateChanged(a);
      const offB = onWatchStateChanged(b);
      emitWatchStateChanged("111");
      expect(a).toHaveBeenCalledWith("111");
      expect(b).toHaveBeenCalledWith("111");
      offA();
      offB();
    });
  });
});
