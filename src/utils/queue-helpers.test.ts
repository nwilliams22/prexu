import { describe, it, expect } from "vitest";
import { buildQueueFromItems, shuffleArray } from "./queue-helpers";
import type { PlexMediaItem } from "../types/library";

describe("buildQueueFromItems", () => {
  it("converts movies to queue items", () => {
    const items: PlexMediaItem[] = [
      {
        ratingKey: "1",
        key: "/library/metadata/1",
        type: "movie",
        title: "The Matrix",
        summary: "",
        thumb: "/thumb/1",
        art: "",
        addedAt: 0,
        updatedAt: 0,
        year: 1999,
        duration: 8160000,
      } as PlexMediaItem & { year: number; duration: number },
    ];

    const result = buildQueueFromItems(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      ratingKey: "1",
      title: "The Matrix",
      subtitle: "1999",
      thumb: "/thumb/1",
      duration: 8160000,
      type: "movie",
    });
  });

  it("converts episodes to queue items with show title and episode code", () => {
    const items = [
      {
        ratingKey: "2",
        key: "/library/metadata/2",
        type: "episode",
        title: "Pilot",
        summary: "",
        thumb: "/thumb/2",
        art: "",
        addedAt: 0,
        updatedAt: 0,
        grandparentTitle: "Breaking Bad",
        grandparentThumb: "/thumb/show",
        parentIndex: 1,
        index: 1,
        duration: 3480000,
      } as unknown as PlexMediaItem,
    ];

    const result = buildQueueFromItems(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      ratingKey: "2",
      title: "Breaking Bad",
      subtitle: "S01E01 · Pilot",
      thumb: "/thumb/show",
      duration: 3480000,
      type: "episode",
    });
  });

  it("filters out non-playable types", () => {
    const items: PlexMediaItem[] = [
      {
        ratingKey: "1",
        key: "",
        type: "movie",
        title: "Movie",
        summary: "",
        thumb: "",
        art: "",
        addedAt: 0,
        updatedAt: 0,
      },
      {
        ratingKey: "2",
        key: "",
        type: "show",
        title: "Show",
        summary: "",
        thumb: "",
        art: "",
        addedAt: 0,
        updatedAt: 0,
      },
      {
        ratingKey: "3",
        key: "",
        type: "season",
        title: "Season 1",
        summary: "",
        thumb: "",
        art: "",
        addedAt: 0,
        updatedAt: 0,
      },
    ];

    const result = buildQueueFromItems(items);
    expect(result).toHaveLength(1);
    expect(result[0].ratingKey).toBe("1");
  });

  it("returns empty array for empty input", () => {
    expect(buildQueueFromItems([])).toEqual([]);
  });
});

describe("shuffleArray", () => {
  it("returns a new array with same elements", () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffleArray(input);
    expect(result).toHaveLength(input.length);
    expect(result.sort()).toEqual(input.sort());
  });

  it("does not mutate the original array", () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    shuffleArray(input);
    expect(input).toEqual(copy);
  });

  it("returns empty array for empty input", () => {
    expect(shuffleArray([])).toEqual([]);
  });

  it("returns single-element array unchanged", () => {
    expect(shuffleArray([42])).toEqual([42]);
  });
});
