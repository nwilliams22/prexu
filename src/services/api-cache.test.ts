import {
  cacheGet,
  cacheSet,
  cacheInvalidate,
  cacheInvalidatePrefix,
  cacheClear,
  cacheUpdateWhere,
  cacheGetAge,
} from "./api-cache";

describe("api-cache", () => {
  beforeEach(() => {
    cacheClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── cacheGet / cacheSet ──

  describe("cacheGet / cacheSet", () => {
    it("returns null for a missing key", () => {
      expect(cacheGet("nonexistent")).toBeNull();
    });

    it("stores and retrieves a value", () => {
      cacheSet("key1", { name: "test" }, 60_000);
      expect(cacheGet("key1")).toEqual({ name: "test" });
    });

    it("stores and retrieves a string value", () => {
      cacheSet("str", "hello", 60_000);
      expect(cacheGet("str")).toBe("hello");
    });

    it("stores and retrieves a numeric value", () => {
      cacheSet("num", 42, 60_000);
      expect(cacheGet("num")).toBe(42);
    });

    it("stores and retrieves an array value", () => {
      const arr = [1, 2, 3];
      cacheSet("arr", arr, 60_000);
      expect(cacheGet("arr")).toEqual([1, 2, 3]);
    });

    it("stores and retrieves a boolean value", () => {
      cacheSet("bool", false, 60_000);
      expect(cacheGet("bool")).toBe(false);
    });

    it("overwrites existing value with same key", () => {
      cacheSet("key1", "first", 60_000);
      cacheSet("key1", "second", 60_000);
      expect(cacheGet("key1")).toBe("second");
    });

    it("returns the value within the TTL window", () => {
      cacheSet("key1", "alive", 10_000);
      vi.advanceTimersByTime(9_999);
      expect(cacheGet("key1")).toBe("alive");
    });

    it("returns null after TTL expires", () => {
      cacheSet("key1", "alive", 10_000);
      vi.advanceTimersByTime(10_001);
      expect(cacheGet("key1")).toBeNull();
    });

    it("returns null exactly at TTL boundary", () => {
      cacheSet("key1", "alive", 10_000);
      vi.advanceTimersByTime(10_001);
      expect(cacheGet("key1")).toBeNull();
    });

    it("handles independent TTLs per key", () => {
      cacheSet("short", "a", 5_000);
      cacheSet("long", "b", 15_000);

      vi.advanceTimersByTime(6_000);
      expect(cacheGet("short")).toBeNull();
      expect(cacheGet("long")).toBe("b");

      vi.advanceTimersByTime(10_000);
      expect(cacheGet("long")).toBeNull();
    });

    it("cleans up expired entries on read", () => {
      cacheSet("temp", "value", 1_000);
      vi.advanceTimersByTime(2_000);
      // First read should clean it up
      expect(cacheGet("temp")).toBeNull();
      // Second read should also return null (entry gone)
      expect(cacheGet("temp")).toBeNull();
    });
  });

  // ── cacheInvalidate ──

  describe("cacheInvalidate", () => {
    it("removes a single entry", () => {
      cacheSet("key1", "a", 60_000);
      cacheSet("key2", "b", 60_000);
      cacheInvalidate("key1");
      expect(cacheGet("key1")).toBeNull();
      expect(cacheGet("key2")).toBe("b");
    });

    it("does nothing for a non-existent key", () => {
      cacheSet("key1", "a", 60_000);
      cacheInvalidate("nonexistent");
      expect(cacheGet("key1")).toBe("a");
    });
  });

  // ── cacheInvalidatePrefix ──

  describe("cacheInvalidatePrefix", () => {
    it("removes all entries matching the prefix", () => {
      cacheSet("library:1:items", "data1", 60_000);
      cacheSet("library:1:filters", "data2", 60_000);
      cacheSet("library:2:items", "data3", 60_000);
      cacheSet("dashboard:main", "data4", 60_000);

      cacheInvalidatePrefix("library:1");

      expect(cacheGet("library:1:items")).toBeNull();
      expect(cacheGet("library:1:filters")).toBeNull();
      expect(cacheGet("library:2:items")).toBe("data3");
      expect(cacheGet("dashboard:main")).toBe("data4");
    });

    it("removes nothing if no keys match", () => {
      cacheSet("key1", "a", 60_000);
      cacheInvalidatePrefix("nomatch");
      expect(cacheGet("key1")).toBe("a");
    });

    it("removes all entries if prefix matches all keys", () => {
      cacheSet("data:a", 1, 60_000);
      cacheSet("data:b", 2, 60_000);
      cacheInvalidatePrefix("data:");
      expect(cacheGet("data:a")).toBeNull();
      expect(cacheGet("data:b")).toBeNull();
    });
  });

  // ── cacheClear ──

  describe("cacheClear", () => {
    it("removes all entries", () => {
      cacheSet("key1", "a", 60_000);
      cacheSet("key2", "b", 60_000);
      cacheSet("key3", "c", 60_000);
      cacheClear();
      expect(cacheGet("key1")).toBeNull();
      expect(cacheGet("key2")).toBeNull();
      expect(cacheGet("key3")).toBeNull();
    });

    it("works when cache is already empty", () => {
      cacheClear();
      expect(cacheGet("anything")).toBeNull();
    });
  });

  // ── cacheUpdateWhere (prexu-8nl0) ──

  describe("cacheUpdateWhere", () => {
    it("replaces the data of matching entries via the updater", () => {
      cacheSet("dashboard:s1:deck", [{ ratingKey: "1", viewOffset: 100 }], 60_000);
      cacheSet("dashboard:s2:deck", [{ ratingKey: "1", viewOffset: 200 }], 60_000);
      cacheSet("dashboard:s1:movies", [{ ratingKey: "1", viewOffset: 999 }], 60_000);

      const updated = cacheUpdateWhere<{ ratingKey: string; viewOffset: number }[]>(
        (key) => key.endsWith(":deck"),
        (items) => items.map((i) => (i.ratingKey === "1" ? { ...i, viewOffset: 5_000 } : i)),
      );

      expect(updated).toBe(2);
      expect(cacheGet("dashboard:s1:deck")).toEqual([{ ratingKey: "1", viewOffset: 5_000 }]);
      expect(cacheGet("dashboard:s2:deck")).toEqual([{ ratingKey: "1", viewOffset: 5_000 }]);
      // Non-matching key untouched, even though its content looks similar.
      expect(cacheGet("dashboard:s1:movies")).toEqual([{ ratingKey: "1", viewOffset: 999 }]);
    });

    it("leaves an entry alone when the updater returns undefined", () => {
      cacheSet("dashboard:s1:deck", [{ ratingKey: "1", viewOffset: 100 }], 60_000);

      const updated = cacheUpdateWhere<{ ratingKey: string; viewOffset: number }[]>(
        (key) => key.endsWith(":deck"),
        () => undefined,
      );

      expect(updated).toBe(0);
      expect(cacheGet("dashboard:s1:deck")).toEqual([{ ratingKey: "1", viewOffset: 100 }]);
    });

    it("leaves an entry alone when the updater returns the same reference", () => {
      const data = [{ ratingKey: "1", viewOffset: 100 }];
      cacheSet("dashboard:s1:deck", data, 60_000);

      const updated = cacheUpdateWhere((key) => key.endsWith(":deck"), (d) => d);

      expect(updated).toBe(0);
      expect(cacheGet("dashboard:s1:deck")).toBe(data);
    });

    it("preserves the entry's original age/TTL instead of resetting the freshness clock", () => {
      cacheSet("dashboard:s1:deck", [{ ratingKey: "1", viewOffset: 100 }], 60_000);
      vi.advanceTimersByTime(10_000);

      cacheUpdateWhere<{ ratingKey: string; viewOffset: number }[]>(
        (key) => key.endsWith(":deck"),
        (items) => items.map((i) => ({ ...i, viewOffset: 5_000 })),
      );

      // A patch is not a fresh fetch — the entry should read as ~10s old,
      // not 0s old, so downstream freshness checks (useDashboard's
      // STALE_THRESHOLD) aren't fooled into treating it as brand-new.
      expect(cacheGetAge("dashboard:s1:deck")).toBe(10_000);
    });

    it("does not throw and updates nothing when no keys match", () => {
      cacheSet("key1", "a", 60_000);
      expect(() => cacheUpdateWhere(() => false, (d) => d)).not.toThrow();
      expect(cacheGet("key1")).toBe("a");
    });

    // ── refreshTtl option (prexu-5mcz) ──
    describe("refreshTtl option", () => {
      it("resets the entry's freshness clock to now when refreshTtl is true", () => {
        cacheSet("item-detail:s1:501", { item: { ratingKey: "501", viewOffset: 100 } }, 30_000);
        vi.advanceTimersByTime(29_000);

        cacheUpdateWhere<{ item: { ratingKey: string; viewOffset: number } }>(
          (key) => key === "item-detail:s1:501",
          (bundle) => ({ ...bundle, item: { ...bundle.item, viewOffset: 5_000 } }),
          { refreshTtl: true },
        );

        // Still within the ORIGINAL 30s window trivially, but prove the
        // clock actually reset: it must also still be fresh 29s further on
        // (59s past the original cacheSet, well past the original TTL).
        expect(cacheGetAge("item-detail:s1:501")).toBe(0);
        vi.advanceTimersByTime(29_000);
        expect(cacheGetAge("item-detail:s1:501")).toBe(29_000);
        expect(cacheGet("item-detail:s1:501")).toEqual({
          item: { ratingKey: "501", viewOffset: 5_000 },
        });
      });

      it("does not refresh the TTL when refreshTtl is omitted (default, unchanged behavior)", () => {
        cacheSet("dashboard:s1:deck", [{ ratingKey: "1", viewOffset: 100 }], 60_000);
        vi.advanceTimersByTime(10_000);

        cacheUpdateWhere<{ ratingKey: string; viewOffset: number }[]>(
          (key) => key.endsWith(":deck"),
          (items) => items.map((i) => ({ ...i, viewOffset: 5_000 })),
        );

        expect(cacheGetAge("dashboard:s1:deck")).toBe(10_000);
      });

      it("does not refresh the TTL when refreshTtl is explicitly false", () => {
        cacheSet("dashboard:s1:deck", [{ ratingKey: "1", viewOffset: 100 }], 60_000);
        vi.advanceTimersByTime(10_000);

        cacheUpdateWhere<{ ratingKey: string; viewOffset: number }[]>(
          (key) => key.endsWith(":deck"),
          (items) => items.map((i) => ({ ...i, viewOffset: 5_000 })),
          { refreshTtl: false },
        );

        expect(cacheGetAge("dashboard:s1:deck")).toBe(10_000);
      });

      it("does not touch untouched entries' timestamps even when refreshTtl is true (no-op updater still skips)", () => {
        cacheSet("item-detail:s1:501", { item: { ratingKey: "501" } }, 30_000);
        vi.advanceTimersByTime(10_000);

        cacheUpdateWhere<{ item: { ratingKey: string } }>(
          () => true,
          () => undefined,
          { refreshTtl: true },
        );

        expect(cacheGetAge("item-detail:s1:501")).toBe(10_000);
      });
    });
  });

  // ── Edge cases ──

  describe("edge cases", () => {
    it("handles empty string key", () => {
      cacheSet("", "empty-key-value", 60_000);
      expect(cacheGet("")).toBe("empty-key-value");
    });

    it("handles null-ish data values", () => {
      cacheSet("null", null, 60_000);
      // null is stored, but cacheGet returns null for both "missing" and "stored null"
      // This is acceptable — callers shouldn't store null
      expect(cacheGet("null")).toBeNull();
    });

    it("handles undefined data", () => {
      cacheSet("undef", undefined, 60_000);
      // undefined is stored as the data value; cacheGet returns it as-is
      expect(cacheGet("undef")).toBeUndefined();
    });

    it("handles zero TTL", () => {
      cacheSet("zero-ttl", "value", 0);
      // Even with 0 TTL, Date.now() - timestamp = 0 which is NOT > 0
      // so it should still be retrievable in the same tick
      expect(cacheGet("zero-ttl")).toBe("value");
    });

    it("handles very large TTL", () => {
      cacheSet("long-lived", "value", Number.MAX_SAFE_INTEGER);
      vi.advanceTimersByTime(100_000_000);
      expect(cacheGet("long-lived")).toBe("value");
    });
  });
});
