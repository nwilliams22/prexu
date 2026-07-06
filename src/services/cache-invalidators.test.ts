import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";
import { cacheSet, cacheGet, cacheGetAge, cacheInvalidateWhere, cacheClear } from "./api-cache";
import {
  invalidateDeckCaches,
  initializeCacheInvalidators,
  DECK_INVALIDATION_DELAY_MS,
  OFFSET_FLOOR_WINDOW_MS,
  applyOffsetFloors,
  registerOffsetFloor,
  __clearOffsetFloorsForTests,
} from "./cache-invalidators";
import { emitWatchStateChanged } from "./watch-state-events";

describe("cache-invalidators", () => {
  beforeEach(() => {
    cacheClear();
    vi.clearAllMocks();
    __clearOffsetFloorsForTests();
  });

  afterEach(() => {
    cacheClear();
    __clearOffsetFloorsForTests();
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

    // Item-detail cache invalidation on watch-state change (prexu-lz4t).
    // Nested here (rather than a sibling describe) so it reuses this block's
    // single beforeAll(initializeCacheInvalidators()) and fake-timer
    // before/afterEach instead of standing up a second listener on `window`.
    describe("item-detail cache invalidation (prexu-lz4t)", () => {
      it("invalidates only item-detail entries for the ratingKey on the event, immediately (no delay)", () => {
        const targetKey = "item-detail:http://server:32400:501";
        const otherKey = "item-detail:http://server:32400:999";
        cacheSet(targetKey, { title: "Target" }, 30_000);
        cacheSet(otherKey, { title: "Other" }, 30_000);

        emitWatchStateChanged("501");

        // No setTimeout needed — unlike the deck cache, item-detail
        // invalidation is synchronous with the event.
        expect(cacheGet(targetKey)).toBeNull();
        expect(cacheGet(otherKey)).toEqual({ title: "Other" });
      });

      it("does not falsely match a ratingKey that is a numeric substring of another key's ratingKey", () => {
        // "501" must not incorrectly match a stored entry for ratingKey "1501".
        const similarKey = "item-detail:http://server:32400:1501";
        cacheSet(similarKey, { title: "Different item" }, 30_000);

        emitWatchStateChanged("501");

        expect(cacheGet(similarKey)).toEqual({ title: "Different item" });
      });

      it("invalidates matching entries across every server when a ratingKey is given", () => {
        const server1Key = "item-detail:http://server1:32400:501";
        const server2Key = "item-detail:http://server2:32400:501";
        cacheSet(server1Key, { title: "Server 1 copy" }, 30_000);
        cacheSet(server2Key, { title: "Server 2 copy" }, 30_000);

        emitWatchStateChanged("501");

        expect(cacheGet(server1Key)).toBeNull();
        expect(cacheGet(server2Key)).toBeNull();
      });

      it("falls back to invalidating every item-detail entry when the event carries no ratingKey", () => {
        const keyA = "item-detail:http://server:32400:501";
        const keyB = "item-detail:http://server:32400:999";
        cacheSet(keyA, { title: "A" }, 30_000);
        cacheSet(keyB, { title: "B" }, 30_000);

        emitWatchStateChanged();

        expect(cacheGet(keyA)).toBeNull();
        expect(cacheGet(keyB)).toBeNull();
      });

      it("leaves non-item-detail cache entries alone regardless of ratingKey targeting", () => {
        const deckKey = "dashboard:http://server:32400:deck";
        const detailKey = "item-detail:http://server:32400:501";
        cacheSet(deckKey, [{ title: "Deck Item" }], 60 * 60 * 1000);
        cacheSet(detailKey, { title: "Detail" }, 30_000);

        emitWatchStateChanged("501");

        // Item-detail entry invalidated immediately...
        expect(cacheGet(detailKey)).toBeNull();
        // ...but the deck entry is untouched until its own delayed
        // invalidation fires (still pending — no timers advanced here).
        expect(cacheGet(deckKey)).not.toBeNull();
      });
    });

    // Optimistic offset patch (prexu-8nl0): when the watch-state-changed
    // event carries a viewOffsetMs, the deck/item-detail caches are patched
    // in place with that known-correct value BEFORE any invalidation runs,
    // instead of depending on a refetch to eventually reflect it.
    describe("optimistic offset patch (prexu-8nl0)", () => {
      it("patches the matching item's viewOffset in a deck cache entry, leaving unrelated items and entries untouched", () => {
        const deckKey = "dashboard:http://server:32400:deck";
        const otherDeckKey = "dashboard:http://server2:32400:deck";
        const moviesKey = "dashboard:http://server:32400:movies";
        cacheSet(
          deckKey,
          [
            { ratingKey: "501", title: "Target", viewOffset: 10_000 },
            { ratingKey: "999", title: "Unrelated", viewOffset: 20_000 },
          ],
          60 * 60 * 1000,
        );
        cacheSet(otherDeckKey, [{ ratingKey: "999", title: "Unrelated 2" }], 60 * 60 * 1000);
        cacheSet(moviesKey, [{ ratingKey: "501", title: "Not deck" }], 60 * 60 * 1000);

        emitWatchStateChanged("501", { viewOffsetMs: 185_000 });

        expect(cacheGet(deckKey)).toEqual([
          { ratingKey: "501", title: "Target", viewOffset: 185_000 },
          { ratingKey: "999", title: "Unrelated", viewOffset: 20_000 },
        ]);
        // Entry with no matching ratingKey is left exactly as-is.
        expect(cacheGet(otherDeckKey)).toEqual([{ ratingKey: "999", title: "Unrelated 2" }]);
        // Non-deck dashboard entry untouched even though it contains the ratingKey.
        expect(cacheGet(moviesKey)).toEqual([{ ratingKey: "501", title: "Not deck" }]);
      });

      it("patches bundle.item.viewOffset in an item-detail cache entry, leaving unrelated entries untouched", () => {
        const targetKey = "item-detail:http://server:32400:501";
        const otherKey = "item-detail:http://server:32400:999";
        cacheSet(
          targetKey,
          { item: { ratingKey: "501", viewOffset: 10_000 }, seasons: [] },
          30_000,
        );
        cacheSet(otherKey, { item: { ratingKey: "999", viewOffset: 20_000 }, seasons: [] }, 30_000);

        emitWatchStateChanged("501", { viewOffsetMs: 185_000 });

        expect(cacheGet(targetKey)).toEqual({
          item: { ratingKey: "501", viewOffset: 185_000 },
          seasons: [],
        });
        expect(cacheGet(otherKey)).toEqual({
          item: { ratingKey: "999", viewOffset: 20_000 },
          seasons: [],
        });
      });

      it("does NOT immediately invalidate the item-detail entry it just patched (unlike the no-offset path)", () => {
        const detailKey = "item-detail:http://server:32400:501";
        cacheSet(detailKey, { item: { ratingKey: "501", viewOffset: 10_000 } }, 30_000);

        emitWatchStateChanged("501", { viewOffsetMs: 185_000 });

        // Patched, not deleted — the fix's whole point is this entry stays
        // correct without needing a refetch.
        expect(cacheGet(detailKey)).toEqual({
          item: { ratingKey: "501", viewOffset: 185_000 },
        });
      });

      it("still schedules the delayed deck invalidation as a belt-and-braces resync when an offset is present", () => {
        const deckKey = "dashboard:http://server:32400:deck";
        cacheSet(deckKey, [{ ratingKey: "501", viewOffset: 10_000 }], 60 * 60 * 1000);

        emitWatchStateChanged("501", { viewOffsetMs: 185_000 });

        // Patched immediately...
        expect(cacheGet(deckKey)).toEqual([{ ratingKey: "501", viewOffset: 185_000 }]);

        // ...and still invalidated once the existing delay elapses (PR #64
        // timing unchanged).
        vi.advanceTimersByTime(DECK_INVALIDATION_DELAY_MS);
        expect(cacheGet(deckKey)).toBeNull();
      });

      // prexu-5mcz: the hardware repro that motivated the detail-path floor
      // showed the item-detail entry crossing its 30s TTL just ONE SECOND
      // after this patch ran — because the patch (before this fix) preserved
      // the entry's ORIGINAL timestamp (from whenever it was first warmed,
      // well before the stop). That let a hover-triggered warmItemDetailCache
      // treat the entry as stale and refetch, racing PMS's ingestion and
      // silently overwriting the patch. The patch must refresh the entry's
      // TTL so a value known to be fresher than any in-window server
      // response doesn't expire behind one.
      it("refreshes the item-detail entry's TTL so it stays warm well past its original expiry", () => {
        const detailKey = "item-detail:http://server:32400:501";
        cacheSet(detailKey, { item: { ratingKey: "501", viewOffset: 10_000 } }, 30_000);
        // Entry is already 29s old — 1s from its original 30s expiry — at
        // the moment the patch runs, matching the hardware repro's timing.
        vi.advanceTimersByTime(29_000);

        emitWatchStateChanged("501", { viewOffsetMs: 185_000 });

        // Immediately after the patch the age must read as 0 (clock reset),
        // not 29_000.
        expect(cacheGetAge(detailKey)).toBe(0);

        // 29s further on (58s past the ORIGINAL cacheSet, well past its
        // original 30s TTL) the entry must still be warm because the patch
        // gave it a fresh 30s window of its own.
        vi.advanceTimersByTime(29_000);
        expect(cacheGetAge(detailKey)).toBe(29_000);
        expect(cacheGet(detailKey)).toEqual({
          item: { ratingKey: "501", viewOffset: 185_000 },
        });
      });

      it("falls back to invalidate-only (old behavior) when the event carries no offset", () => {
        const detailKey = "item-detail:http://server:32400:501";
        cacheSet(detailKey, { item: { ratingKey: "501", viewOffset: 10_000 } }, 30_000);

        emitWatchStateChanged("501");

        expect(cacheGet(detailKey)).toBeNull();
      });

      it("does nothing to caches when only an offset is present but no ratingKey (falls back to broad item-detail sweep)", () => {
        const detailKey = "item-detail:http://server:32400:501";
        const deckKey = "dashboard:http://server:32400:deck";
        cacheSet(detailKey, { item: { ratingKey: "501", viewOffset: 10_000 } }, 30_000);
        cacheSet(deckKey, [{ ratingKey: "501", viewOffset: 10_000 }], 60 * 60 * 1000);

        // No ratingKey on the event — nothing to key a patch off of.
        emitWatchStateChanged(undefined, { viewOffsetMs: 185_000 });

        expect(cacheGet(detailKey)).toBeNull();
        // Deck is untouched until the delayed invalidation (unchanged path).
        expect(cacheGet(deckKey)).not.toBeNull();
      });
    });

    // applyOffsetFloors is the merge guard useDashboard's fetchDeck consults
    // right after getOnDeck() resolves, so a refetch that lands before PMS
    // finishes ingesting the stop write can't silently regress the patch
    // above. Unit-tested directly here since it's pure/synchronous.
    describe("applyOffsetFloors merge guard (prexu-8nl0)", () => {
      it("is a no-op (same array reference) when no floors are registered", () => {
        const items = [{ ratingKey: "501", viewOffset: 10_000 }];
        expect(applyOffsetFloors(items)).toBe(items);
      });

      it("overrides a stale (smaller) fetched offset with the floor value", () => {
        registerOffsetFloor("501", 185_000, false);
        const result = applyOffsetFloors([{ ratingKey: "501", viewOffset: 10_000 }]);
        expect(result).toEqual([{ ratingKey: "501", viewOffset: 185_000 }]);
      });

      it("trusts a fetched offset that is equal to or larger than the floor (newer/larger server offsets win)", () => {
        registerOffsetFloor("501", 185_000, false);
        const result = applyOffsetFloors([{ ratingKey: "501", viewOffset: 200_000 }]);
        expect(result).toEqual([{ ratingKey: "501", viewOffset: 200_000 }]);
      });

      it("leaves items with no matching floor untouched", () => {
        registerOffsetFloor("501", 185_000, false);
        const items = [{ ratingKey: "999", viewOffset: 10_000 }];
        expect(applyOffsetFloors(items)).toBe(items);
      });

      it("a reset floor always wins, even over a much larger fetched offset", () => {
        registerOffsetFloor("501", 0, true);
        const result = applyOffsetFloors([{ ratingKey: "501", viewOffset: 185_000 }]);
        expect(result).toEqual([{ ratingKey: "501", viewOffset: 0 }]);
      });

      it("stops overriding once the floor's window has expired", () => {
        registerOffsetFloor("501", 185_000, false);
        vi.advanceTimersByTime(OFFSET_FLOOR_WINDOW_MS + 1);
        const items = [{ ratingKey: "501", viewOffset: 10_000 }];
        expect(applyOffsetFloors(items)).toBe(items);
      });

      it("still protects right up to the boundary of the floor window", () => {
        registerOffsetFloor("501", 185_000, false);
        vi.advanceTimersByTime(OFFSET_FLOOR_WINDOW_MS - 1);
        const result = applyOffsetFloors([{ ratingKey: "501", viewOffset: 10_000 }]);
        expect(result).toEqual([{ ratingKey: "501", viewOffset: 185_000 }]);
      });
    });

    // prexu-dqfc: OFFSET_FLOOR_WINDOW_MS used to be a flat 5s measured from
    // the SAME instant useDashboard's own on-event listener fired its
    // (undelayed) refetch. A hardware repro showed a real PMS onDeck-rebuild
    // response landing after that flat window had already expired, cementing
    // a stale pre-stop offset into both state and the 60-minute deck cache.
    // The fix delays useDashboard's refetch by DECK_INVALIDATION_DELAY_MS (the
    // same ingestion buffer this module's own backstop invalidation already
    // trusted) and widens the floor to cover that delay PLUS the original
    // network-latency margin — otherwise the delay would just eat into the
    // floor's remaining protection for the fetch's own round trip.
    describe("OFFSET_FLOOR_WINDOW_MS sizing (prexu-dqfc)", () => {
      it("covers the deck-refresh scheduling delay plus the original network-latency margin", () => {
        expect(OFFSET_FLOOR_WINDOW_MS).toBe(DECK_INVALIDATION_DELAY_MS + 5_000);
      });

      it("is strictly larger than the scheduling delay alone, so a same-tick refetch still has real protection left after the delay elapses", () => {
        expect(OFFSET_FLOOR_WINDOW_MS).toBeGreaterThan(DECK_INVALIDATION_DELAY_MS);
      });
    });
  });
});
