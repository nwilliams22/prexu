import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";
import { cacheSet, cacheGet, cacheInvalidateWhere, cacheClear } from "./api-cache";
import {
  invalidateDeckCaches,
  initializeCacheInvalidators,
  DECK_INVALIDATION_DELAY_MS,
} from "./cache-invalidators";
import { emitWatchStateChanged } from "./watch-state-events";

describe("cache-invalidators", () => {
  beforeEach(() => {
    cacheClear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cacheClear();
  });

  describe("invalidateDeckCaches", () => {
    it("should invalidate all deck cache entries matching the pattern", () => {
      // Setup: store some cache entries with different patterns
      const server1Uri = "http://server1:32400";
      const server2Uri = "http://server2:32400";
      const mockMovies = [{ title: "Movie 1" }];
      const mockShows = [{ title: "Show 1" }];
      const mockDeck = [{ title: "Deck Item 1" }];

      // Store deck entries for multiple servers
      cacheSet(`dashboard:${server1Uri}:deck`, mockDeck, 60 * 60 * 1000);
      cacheSet(`dashboard:${server2Uri}:deck`, mockDeck, 60 * 60 * 1000);

      // Also store other dashboard entries to verify they're NOT invalidated
      cacheSet(`dashboard:${server1Uri}:movies`, mockMovies, 60 * 60 * 1000);
      cacheSet(`dashboard:${server1Uri}:shows`, mockShows, 60 * 60 * 1000);

      // Verify entries exist before invalidation
      expect(cacheGet(`dashboard:${server1Uri}:deck`)).toEqual(mockDeck);
      expect(cacheGet(`dashboard:${server2Uri}:deck`)).toEqual(mockDeck);
      expect(cacheGet(`dashboard:${server1Uri}:movies`)).toEqual(mockMovies);
      expect(cacheGet(`dashboard:${server1Uri}:shows`)).toEqual(mockShows);

      // Invalidate deck caches
      invalidateDeckCaches();

      // Deck entries should be gone
      expect(cacheGet(`dashboard:${server1Uri}:deck`)).toBeNull();
      expect(cacheGet(`dashboard:${server2Uri}:deck`)).toBeNull();

      // Other dashboard entries should still exist
      expect(cacheGet(`dashboard:${server1Uri}:movies`)).toEqual(mockMovies);
      expect(cacheGet(`dashboard:${server1Uri}:shows`)).toEqual(mockShows);
    });

    it("should handle case when no deck entries exist", () => {
      const mockMovies = [{ title: "Movie 1" }];
      cacheSet("dashboard:http://server:32400:movies", mockMovies, 60 * 60 * 1000);

      // Should not throw
      expect(() => invalidateDeckCaches()).not.toThrow();

      // Movies cache should remain
      expect(cacheGet("dashboard:http://server:32400:movies")).toEqual(mockMovies);
    });

    it("should invalidate only entries matching dashboard:...:deck pattern", () => {
      const unrelatedData = [{ id: "unrelated" }];
      const deckData = [{ title: "Deck Item" }];

      // Store entries with similar but non-matching patterns
      cacheSet("dashboard", unrelatedData, 60 * 60 * 1000);
      cacheSet("dashboard:movies", unrelatedData, 60 * 60 * 1000);
      cacheSet("dashboard:deck", unrelatedData, 60 * 60 * 1000); // This matches!
      cacheSet("other:deck", unrelatedData, 60 * 60 * 1000);
      cacheSet("dashboard:http://server:32400:deck", deckData, 60 * 60 * 1000); // This matches!
      cacheSet("dashboard:http://server:32400:deck:extra", unrelatedData, 60 * 60 * 1000);

      invalidateDeckCaches();

      // Only matching entries should be gone
      expect(cacheGet("dashboard")).toEqual(unrelatedData);
      expect(cacheGet("dashboard:movies")).toEqual(unrelatedData);
      expect(cacheGet("dashboard:deck")).toBeNull(); // Matches: starts with dashboard:, ends with :deck
      expect(cacheGet("other:deck")).toEqual(unrelatedData);
      expect(cacheGet("dashboard:http://server:32400:deck")).toBeNull(); // Matches
      expect(cacheGet("dashboard:http://server:32400:deck:extra")).toEqual(unrelatedData);
    });
  });

  describe("cacheInvalidateWhere", () => {
    it("should invalidate entries matching the predicate", () => {
      const data1 = { value: 1 };
      const data2 = { value: 2 };

      cacheSet("keep:this:one", data1, 60 * 60 * 1000);
      cacheSet("remove:this:one", data2, 60 * 60 * 1000);
      cacheSet("also:remove", data2, 60 * 60 * 1000);

      cacheInvalidateWhere((key) => key.includes("remove"));

      expect(cacheGet("keep:this:one")).toEqual(data1);
      expect(cacheGet("remove:this:one")).toBeNull();
      expect(cacheGet("also:remove")).toBeNull();
    });

    it("should handle localStorage cleanup", () => {
      const data = [{ test: "data" }];
      // Set with persist: true to write to localStorage
      cacheSet("dashboard:server:deck", data, 60 * 60 * 1000, true);
      cacheSet("dashboard:server:movies", data, 60 * 60 * 1000, true);

      // Verify entries are in both memory and storage
      expect(cacheGet("dashboard:server:deck")).toEqual(data);

      // Invalidate by pattern
      cacheInvalidateWhere((key) => key.endsWith(":deck"));

      // Deck should be gone from both memory and localStorage
      expect(cacheGet("dashboard:server:deck")).toBeNull();

      // Movies should still exist
      expect(cacheGet("dashboard:server:movies")).toEqual(data);
    });

    it("should not remove non-cache localStorage keys even if the sliced name matches", () => {
      // A localStorage key WITHOUT the cache prefix (e.g. an app preference)
      // whose name — after being blindly sliced by STORAGE_PREFIX.length —
      // would match the predicate. Must NOT be removed.
      // STORAGE_PREFIX is "prexu_cache:" (12 chars); this key is longer than
      // that and its sliced remainder ends with ":deck".
      const preferenceKey = "user_pref_settings:layout:deck";
      localStorage.setItem(preferenceKey, JSON.stringify({ layout: "grid" }));

      // Also a persisted cache entry that DOES match, to prove the sweep runs
      const data = [{ test: "data" }];
      cacheSet("dashboard:server:deck", data, 60 * 60 * 1000, true);

      cacheInvalidateWhere((key) => key.endsWith(":deck"));

      // The cache entry is gone...
      expect(cacheGet("dashboard:server:deck")).toBeNull();
      // ...but the unrelated preference key survives untouched
      expect(localStorage.getItem(preferenceKey)).toEqual(
        JSON.stringify({ layout: "grid" }),
      );

      localStorage.removeItem(preferenceKey);
    });
  });

  // initializeCacheInvalidators wires a listener that never unsubscribes
  // (by design — it must outlive Dashboard mount/unmount cycles), so it is
  // initialized exactly ONCE for this whole describe block rather than per
  // test. Calling it again per-test would stack additional listeners on
  // `window` and each would independently schedule its own invalidation,
  // making call-count assertions meaningless.
  describe("initializeCacheInvalidators (deck invalidation delay, prexu-ix52)", () => {
    beforeAll(() => {
      initializeCacheInvalidators();
    });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      // Drain any timers this test scheduled before switching back to real
      // timers, so a leftover scheduled invalidation can't fire during a
      // later test that expects real timers.
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    });

    it("does not invalidate the deck cache synchronously when watch state changes", () => {
      const deckKey = "dashboard:http://server:32400:deck";
      cacheSet(deckKey, [{ title: "Deck Item" }], 60 * 60 * 1000);

      emitWatchStateChanged();

      // Still present immediately after the event — the reaction is delayed.
      expect(cacheGet(deckKey)).not.toBeNull();
    });

    it("invalidates the deck cache once DECK_INVALIDATION_DELAY_MS has elapsed", () => {
      const deckKey = "dashboard:http://server:32400:deck";
      cacheSet(deckKey, [{ title: "Deck Item" }], 60 * 60 * 1000);

      emitWatchStateChanged();
      vi.advanceTimersByTime(DECK_INVALIDATION_DELAY_MS);

      expect(cacheGet(deckKey)).toBeNull();
    });

    it("does not invalidate 1ms before the delay elapses (boundary)", () => {
      const deckKey = "dashboard:http://server:32400:deck";
      cacheSet(deckKey, [{ title: "Deck Item" }], 60 * 60 * 1000);

      emitWatchStateChanged();
      vi.advanceTimersByTime(DECK_INVALIDATION_DELAY_MS - 1);
      expect(cacheGet(deckKey)).not.toBeNull();

      vi.advanceTimersByTime(1);
      expect(cacheGet(deckKey)).toBeNull();
    });
  });
});
