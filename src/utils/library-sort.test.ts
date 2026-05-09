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
});
