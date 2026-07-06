import { describe, it, expect } from "vitest";
import {
  expandRange,
  chunkOffsetsForRange,
  isChunkLoaded,
  mergeChunk,
  RANGE_CHUNK_SIZE,
  RANGE_OVERSCAN,
} from "./library-range";

describe("expandRange", () => {
  it("expands both sides by the overscan amount", () => {
    expect(expandRange(100, 150, 1000, 50)).toEqual({ start: 50, end: 200 });
  });

  it("clamps the start at 0", () => {
    expect(expandRange(10, 40, 1000, 50)).toEqual({ start: 0, end: 90 });
  });

  it("clamps the end at total", () => {
    expect(expandRange(950, 990, 1000, 50)).toEqual({ start: 900, end: 1000 });
  });

  it("returns an empty range when total is 0 (totalSize not known yet)", () => {
    expect(expandRange(0, 50, 0, 50)).toEqual({ start: 0, end: 0 });
  });

  it("handles a range wider than total", () => {
    expect(expandRange(0, 40, 30, 50)).toEqual({ start: 0, end: 30 });
  });
});

describe("chunkOffsetsForRange", () => {
  it("computes chunk-aligned offsets covering the range", () => {
    expect(chunkOffsetsForRange(120, 260, 1000, 50)).toEqual([
      100, 150, 200, 250,
    ]);
  });

  it("returns a single offset for a range within one chunk", () => {
    expect(chunkOffsetsForRange(10, 20, 1000, 50)).toEqual([0]);
  });

  it("clamps to total size", () => {
    expect(chunkOffsetsForRange(980, 1050, 1000, 50)).toEqual([950]);
  });

  it("returns empty for a degenerate range", () => {
    expect(chunkOffsetsForRange(50, 50, 1000, 50)).toEqual([]);
    expect(chunkOffsetsForRange(50, 10, 1000, 50)).toEqual([]);
  });

  it("returns empty when total is 0", () => {
    expect(chunkOffsetsForRange(0, 50, 0, 50)).toEqual([]);
  });

  it("matches the real hook constants (jump-to-bottom of a 2000-item library)", () => {
    // Simulates scrolling straight to the bottom of a 2000-item section.
    const offsets = chunkOffsetsForRange(
      1950,
      2000,
      2000,
      RANGE_CHUNK_SIZE,
    );
    expect(offsets).toEqual([1950]);
    void RANGE_OVERSCAN;
  });
});

describe("isChunkLoaded", () => {
  it("is false when any slot in the chunk is undefined", () => {
    const store = [1, 2, undefined, 4];
    expect(isChunkLoaded(store, 0, 4, 4)).toBe(false);
  });

  it("is true when every slot in the chunk (up to total) is defined", () => {
    const store = [1, 2, 3, 4];
    expect(isChunkLoaded(store, 0, 4, 4)).toBe(true);
  });

  it("only checks up to total, ignoring slots beyond the section end", () => {
    const store = [1, 2]; // total is 2; chunk size 4 would look past the end
    expect(isChunkLoaded(store, 0, 4, 2)).toBe(true);
  });

  it("treats an out-of-bounds offset (store shorter than offset) as not loaded", () => {
    const store = [1, 2];
    expect(isChunkLoaded(store, 10, 4, 20)).toBe(false);
  });
});

describe("mergeChunk", () => {
  it("writes items at the given offset into a fresh dense store", () => {
    const result = mergeChunk<number>([], 0, [10, 20, 30], 10);
    expect(result).toEqual([10, 20, 30, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(result.length).toBe(10);
  });

  it("preserves previously-merged chunks elsewhere in the store", () => {
    const first = mergeChunk<number>([], 0, [1, 2], 10);
    const second = mergeChunk<number>(first, 5, [50, 60], 10);
    expect(second).toEqual([1, 2, undefined, undefined, undefined, 50, 60, undefined, undefined, undefined]);
  });

  it("never produces real JS holes — every slot up to total is an explicit value or undefined", () => {
    const result = mergeChunk<number>([], 100, [1, 2], 200);
    // Array.prototype.map/filter skip real holes but visit explicit
    // undefined — this assertion would fail on a hole-y array because the
    // mapped array would be *shorter* than `result`.
    const mapped = result.map((x) => (x === undefined ? "gap" : x));
    expect(mapped.length).toBe(result.length);
    expect(mapped.length).toBe(200);
    expect(mapped[0]).toBe("gap");
    expect(mapped[100]).toBe(1);
    expect(mapped[101]).toBe(2);
  });

  it("does not write past the total boundary", () => {
    const result = mergeChunk<number>([], 8, [1, 2, 3, 4], 10);
    expect(result.length).toBe(10);
    expect(result[8]).toBe(1);
    expect(result[9]).toBe(2);
  });

  it("truncates the store if total shrinks (defensive — sort/filter switch)", () => {
    const bigStore = mergeChunk<number>([], 0, [1, 2, 3, 4, 5], 5);
    const shrunk = mergeChunk<number>(bigStore, 0, [9], 2);
    expect(shrunk).toEqual([9, 2]);
  });
});
