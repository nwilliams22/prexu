import { describe, it, expect, vi, beforeEach } from "vitest";

// Keep the real plex-library exports (the module and its transitive UI imports
// need them) but stub the two watch-state writers.
vi.mock("../services/plex-library", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/plex-library")>()),
  markAsWatched: vi.fn().mockResolvedValue(undefined),
  markAsUnwatched: vi.fn().mockResolvedValue(undefined),
}));

// Avoid Tauri IPC from the logger during applyWatchedToggle.
vi.mock("../services/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

import { watchedToggleActions, applyWatchedToggle } from "./useMediaContextMenu";
import {
  onWatchStateChangedDetail,
  type WatchStateChangedDetail,
} from "../services/watch-state-events";
import * as plexLibrary from "../services/plex-library";

const mockMarkWatched = vi.mocked(plexLibrary.markAsWatched);
const mockMarkUnwatched = vi.mocked(plexLibrary.markAsUnwatched);
const server = { uri: "https://plex.test", accessToken: "tok" };

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

describe("applyWatchedToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkWatched.mockResolvedValue(undefined);
    mockMarkUnwatched.mockResolvedValue(undefined);
  });

  it("mark-as-watched scrobbles then emits an authoritative reset watch-state event", async () => {
    const events: WatchStateChangedDetail[] = [];
    const off = onWatchStateChangedDetail((d) => events.push(d));

    await applyWatchedToggle("watched", server, "42");
    off();

    expect(mockMarkWatched).toHaveBeenCalledWith("https://plex.test", "tok", "42");
    expect(mockMarkUnwatched).not.toHaveBeenCalled();
    // reset:true + viewOffset 0 = "this item has no resume point", so deck /
    // detail caches drop the stale progress instead of ignoring the toggle.
    expect(events).toContainEqual({ ratingKey: "42", viewOffsetMs: 0, reset: true });
  });

  it("mark-as-unwatched unscrobbles then emits the watch-state event", async () => {
    const events: WatchStateChangedDetail[] = [];
    const off = onWatchStateChangedDetail((d) => events.push(d));

    await applyWatchedToggle("unwatched", server, "7");
    off();

    expect(mockMarkUnwatched).toHaveBeenCalledWith("https://plex.test", "tok", "7");
    expect(mockMarkWatched).not.toHaveBeenCalled();
    expect(events).toContainEqual({ ratingKey: "7", viewOffsetMs: 0, reset: true });
  });

  it("does not emit when the mark request fails", async () => {
    mockMarkWatched.mockRejectedValue(new Error("500"));
    const events: WatchStateChangedDetail[] = [];
    const off = onWatchStateChangedDetail((d) => events.push(d));

    await expect(applyWatchedToggle("watched", server, "9")).rejects.toThrow("500");
    off();

    expect(events).toHaveLength(0);
  });
});
