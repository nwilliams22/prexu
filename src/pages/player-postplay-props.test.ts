/**
 * Unit tests for player-postplay-props helpers (prexu-9sg).
 *
 * Pure helpers — no React, no async, no IO. Cover the field-shaping
 * rules used by PostPlayScreen's hero card and the "Coming up" strip.
 */

import { describe, it, expect } from "vitest";
import {
  derivePostPlayDetailProps,
  deriveUpNextSlice,
} from "./player-postplay-props";
import type { PlexEpisode, PlexMediaItem, PlexMovie } from "../types/library";
import type { PlaybackQueue, QueueItem } from "../types/queue";

function makeQueueItem(ratingKey: string, title = `Item ${ratingKey}`): QueueItem {
  return {
    ratingKey,
    type: "episode",
    title,
    subtitle: "S01E01 — Pilot",
    thumb: `/thumb/${ratingKey}`,
    duration: 1_800_000,
  };
}

function makeQueue(items: QueueItem[], currentIndex: number): PlaybackQueue {
  return { items, currentIndex, source: "user-built" };
}

describe("derivePostPlayDetailProps", () => {
  it("returns all undefined when detail is null", () => {
    expect(derivePostPlayDetailProps(null)).toEqual({
      synopsis: undefined,
      airDate: undefined,
      watched: undefined,
      directors: undefined,
      cast: undefined,
    });
  });

  it("pulls summary into synopsis", () => {
    const detail = { type: "episode", summary: "Pilot episode synopsis." } as PlexMediaItem;
    expect(derivePostPlayDetailProps(detail).synopsis).toBe("Pilot episode synopsis.");
  });

  it("treats empty-string summary as undefined synopsis", () => {
    const detail = { type: "episode", summary: "" } as PlexMediaItem;
    expect(derivePostPlayDetailProps(detail).synopsis).toBeUndefined();
  });

  it("formats originallyAvailableAt as a localized date string", () => {
    const detail = {
      type: "episode",
      originallyAvailableAt: "2024-06-15",
    } as PlexEpisode;
    const result = derivePostPlayDetailProps(detail);
    expect(result.airDate).toBeDefined();
    expect(result.airDate).toMatch(/2024/);
  });

  it("returns airDate=undefined when originallyAvailableAt is missing", () => {
    const detail = { type: "movie", title: "Foo" } as PlexMovie;
    expect(derivePostPlayDetailProps(detail).airDate).toBeUndefined();
  });

  it("derives watched=true when viewCount > 0", () => {
    const detail = {
      type: "episode",
      viewCount: 3,
    } as unknown as PlexMediaItem;
    expect(derivePostPlayDetailProps(detail).watched).toBe(true);
  });

  it("derives watched=false when viewCount is 0 or absent", () => {
    expect(
      derivePostPlayDetailProps({ type: "episode" } as PlexMediaItem).watched,
    ).toBe(false);
    expect(
      derivePostPlayDetailProps({
        type: "episode",
        viewCount: 0,
      } as unknown as PlexMediaItem).watched,
    ).toBe(false);
  });

  it("caps directors at 3 entries", () => {
    const detail = {
      type: "movie",
      Director: [
        { tag: "A" },
        { tag: "B" },
        { tag: "C" },
        { tag: "D" },
        { tag: "E" },
      ],
    } as unknown as PlexMovie;
    expect(derivePostPlayDetailProps(detail).directors).toEqual(["A", "B", "C"]);
  });

  it("caps cast at 3 entries", () => {
    const detail = {
      type: "movie",
      Role: [
        { tag: "Alice" },
        { tag: "Bob" },
        { tag: "Carol" },
        { tag: "Dave" },
      ],
    } as unknown as PlexMovie;
    expect(derivePostPlayDetailProps(detail).cast).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
  });

  it("returns directors=undefined when no Director field", () => {
    const detail = { type: "episode" } as PlexMediaItem;
    expect(derivePostPlayDetailProps(detail).directors).toBeUndefined();
  });
});

describe("deriveUpNextSlice", () => {
  it("returns undefined when queue is empty", () => {
    expect(deriveUpNextSlice(makeQueue([], 0))).toBeUndefined();
  });

  it("returns undefined when no items exist past currentIndex+1", () => {
    // Currently playing is the last item — nothing 'after the next one'.
    const items = [makeQueueItem("1"), makeQueueItem("2")];
    expect(deriveUpNextSlice(makeQueue(items, 1))).toBeUndefined();
  });

  it("returns items starting at currentIndex+2", () => {
    const items = [
      makeQueueItem("1"),
      makeQueueItem("2"),
      makeQueueItem("3"),
      makeQueueItem("4"),
    ];
    const result = deriveUpNextSlice(makeQueue(items, 0));
    expect(result).toHaveLength(2);
    expect(result?.[0].ratingKey).toBe("3");
    expect(result?.[1].ratingKey).toBe("4");
  });

  it("caps the slice at 4 items", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeQueueItem(String(i + 1)),
    );
    // currentIndex=0, slice starts at index 2 — should return items 3,4,5,6.
    const result = deriveUpNextSlice(makeQueue(items, 0));
    expect(result).toHaveLength(4);
    expect(result?.map((it) => it.ratingKey)).toEqual(["3", "4", "5", "6"]);
  });
});
