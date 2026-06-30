import { describe, it, expect } from "vitest";
import { watchedToggleActions } from "./useMediaContextMenu";

describe("watchedToggleActions", () => {
  it("unwatched, no progress → only Mark as Watched", () => {
    expect(watchedToggleActions({})).toEqual(["watched"]);
    expect(watchedToggleActions({ viewCount: 0, viewOffset: 0 })).toEqual([
      "watched",
    ]);
  });

  it("unwatched, in progress → both, watched first", () => {
    expect(watchedToggleActions({ viewOffset: 12345 })).toEqual([
      "watched",
      "unwatched",
    ]);
  });

  it("watched, no progress → only Mark as Unwatched", () => {
    expect(watchedToggleActions({ viewCount: 1 })).toEqual(["unwatched"]);
  });

  // The prexu-i5dq bug: a previously-watched item resumed into Continue
  // Watching used to offer only "Mark as Unwatched".
  it("watched AND in progress → both, unwatched first", () => {
    expect(
      watchedToggleActions({ viewCount: 2, viewOffset: 60000 }),
    ).toEqual(["unwatched", "watched"]);
  });

  it("an in-progress item always offers both regardless of prior watched state", () => {
    const firstTime = watchedToggleActions({ viewOffset: 1 });
    const rewatch = watchedToggleActions({ viewCount: 1, viewOffset: 1 });
    expect(new Set(firstTime)).toEqual(new Set(["watched", "unwatched"]));
    expect(new Set(rewatch)).toEqual(new Set(["watched", "unwatched"]));
  });
});
