import { describe, it, expect } from "vitest";
import {
  getLibrarySortKey,
  getLibrarySortBucket,
  findFirstIndexForLetter,
} from "./library-sort";

describe("library-sort", () => {
  describe("getLibrarySortKey", () => {
    it("prefers titleSort when present", () => {
      expect(
        getLibrarySortKey({ titleSort: "Matrix", title: "The Matrix" }),
      ).toBe("Matrix");
    });

    it("strips leading 'The ' from title fallback", () => {
      expect(getLibrarySortKey({ title: "The Matrix" })).toBe("Matrix");
    });

    it("strips leading 'A ' article from title fallback", () => {
      expect(getLibrarySortKey({ title: "A Beautiful Mind" })).toBe(
        "Beautiful Mind",
      );
    });

    it("strips leading 'An ' article from title fallback", () => {
      expect(getLibrarySortKey({ title: "An American Tail" })).toBe(
        "American Tail",
      );
    });

    it("article-stripping is case-insensitive", () => {
      expect(getLibrarySortKey({ title: "THE Thing" })).toBe("Thing");
    });

    it("does not strip when 'A' is part of a word", () => {
      expect(getLibrarySortKey({ title: "Avatar" })).toBe("Avatar");
    });

    it("returns title unchanged when no leading article", () => {
      expect(getLibrarySortKey({ title: "Inception" })).toBe("Inception");
    });

    it("handles empty input gracefully", () => {
      expect(getLibrarySortKey({})).toBe("");
    });
  });

  describe("getLibrarySortBucket", () => {
    it("returns the first letter uppercased", () => {
      expect(getLibrarySortBucket({ title: "Inception" })).toBe("I");
    });

    it("buckets numeric titles to '#'", () => {
      expect(getLibrarySortBucket({ title: "12 Monkeys" })).toBe("#");
    });

    it("respects article stripping when bucketing", () => {
      expect(getLibrarySortBucket({ title: "The Matrix" })).toBe("M");
    });

    it("buckets empty input to '#'", () => {
      expect(getLibrarySortBucket({})).toBe("#");
    });
  });

  describe("findFirstIndexForLetter", () => {
    const items = [
      { title: "Alien" },
      { title: "Blade Runner" },
      { title: "12 Monkeys" },
      { title: "The Matrix" },
    ];

    it("returns the first matching index", () => {
      expect(findFirstIndexForLetter(items, "B")).toBe(1);
    });

    it("respects sort key normalization (Matrix → M)", () => {
      expect(findFirstIndexForLetter(items, "M")).toBe(3);
    });

    it("matches '#' for non-alpha leading char", () => {
      expect(findFirstIndexForLetter(items, "#")).toBe(2);
    });

    it("returns -1 when no match found", () => {
      expect(findFirstIndexForLetter(items, "Z")).toBe(-1);
    });

    it("accepts lowercase letter input", () => {
      expect(findFirstIndexForLetter(items, "b")).toBe(1);
    });
  });

  // prexu-6qi5.2: the fallback scan (used when the firstCharacter index is
  // unavailable or filters are active) now runs against a sparse-by-index
  // store and needs >= semantics matching the fast path's cascading
  // zero-size-bucket behaviour.
  describe("findFirstIndexForLetter — sparse store & >= semantics (prexu-6qi5.2)", () => {
    it("skips unfetched (undefined) slots instead of treating them as a mismatch", () => {
      const sparse = [
        undefined,
        { title: "Blade Runner" }, // B
        undefined,
        { title: "The Matrix" }, // M
      ];
      expect(findFirstIndexForLetter(sparse, "M")).toBe(3);
    });

    it("lands on the next existing bucket when the exact letter has no items (>= semantics)", () => {
      // No "C"-bucket item exists; the next bucket present is "M" (Matrix).
      const items = [{ title: "Alien" }, { title: "Blade Runner" }, { title: "The Matrix" }];
      expect(findFirstIndexForLetter(items, "C")).toBe(2);
    });

    it(">= fallback also skips unfetched slots when searching for the next bucket", () => {
      const sparse = [
        { title: "Alien" }, // A
        undefined, // unfetched — must not be mistaken for the "next" match
        { title: "The Matrix" }, // M
      ];
      expect(findFirstIndexForLetter(sparse, "C")).toBe(2);
    });

    it("returns -1 when every populated slot sorts before the target and none after", () => {
      const items = [{ title: "Alien" }, { title: "Blade Runner" }];
      expect(findFirstIndexForLetter(items, "Z")).toBe(-1);
    });

    it("returns -1 for an entirely unfetched (all-undefined) store", () => {
      const sparse = [undefined, undefined, undefined];
      expect(findFirstIndexForLetter(sparse, "M")).toBe(-1);
    });

    it("prefers an exact match over a >= candidate encountered earlier in scan order", () => {
      // Index 0 ("The Matrix", bucket M) is a >= candidate for target "B"
      // (M > B), but index 1 ("Blade Runner") is an EXACT match — the exact
      // match must win even though the >= candidate was seen first.
      const items = [{ title: "The Matrix" }, { title: "Blade Runner" }];
      expect(findFirstIndexForLetter(items, "B")).toBe(1);
    });
  });
});
