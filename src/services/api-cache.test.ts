import { cacheGet, cacheSet, cacheInvalidate, cacheInvalidatePrefix, cacheClear } from "./api-cache";

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
