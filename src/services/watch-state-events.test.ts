import { describe, it, expect, vi } from "vitest";
import {
  emitWatchStateChanged,
  onWatchStateChanged,
  onWatchStateChangedDetail,
} from "./watch-state-events";

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

  // prexu-8nl0: the event can now also carry the final viewOffset (and, for
  // an early-stop clear, a `reset` flag) known at stop time, so listeners can
  // patch caches directly instead of depending on a refetch. onWatchStateChanged
  // (tested above) intentionally keeps ignoring this payload — only the new
  // onWatchStateChangedDetail exposes it, to keep every existing subscriber's
  // contract frozen.
  describe("offset payload (prexu-8nl0)", () => {
    it("onWatchStateChanged still only calls handlers with the ratingKey when an offset is present", () => {
      const handler = vi.fn();
      const off = onWatchStateChanged(handler);
      emitWatchStateChanged("66324", { viewOffsetMs: 188_000 });
      expect(handler).toHaveBeenCalledWith("66324");
      off();
    });

    it("onWatchStateChangedDetail delivers ratingKey + viewOffsetMs for a recorded resume offset", () => {
      const handler = vi.fn();
      const off = onWatchStateChangedDetail(handler);
      emitWatchStateChanged("66324", { viewOffsetMs: 188_000 });
      expect(handler).toHaveBeenCalledWith({
        ratingKey: "66324",
        viewOffsetMs: 188_000,
        reset: undefined,
      });
      off();
    });

    it("onWatchStateChangedDetail delivers reset:true for an early-stop clear", () => {
      const handler = vi.fn();
      const off = onWatchStateChangedDetail(handler);
      emitWatchStateChanged("66324", { viewOffsetMs: 0, reset: true });
      expect(handler).toHaveBeenCalledWith({
        ratingKey: "66324",
        viewOffsetMs: 0,
        reset: true,
      });
      off();
    });

    it("onWatchStateChangedDetail delivers an empty object when emitted with no arguments", () => {
      const handler = vi.fn();
      const off = onWatchStateChangedDetail(handler);
      emitWatchStateChanged();
      expect(handler).toHaveBeenCalledWith({});
      off();
    });

    it("onWatchStateChangedDetail delivers just the ratingKey when no offset is passed (back-compat call sites)", () => {
      const handler = vi.fn();
      const off = onWatchStateChangedDetail(handler);
      emitWatchStateChanged("66324");
      expect(handler).toHaveBeenCalledWith({
        ratingKey: "66324",
        viewOffsetMs: undefined,
        reset: undefined,
      });
      off();
    });
  });
});
