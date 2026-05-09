import { describe, it, expect } from "vitest";
import { hasNextItem } from "./player-postplay-gate";
import type { PlaybackQueue, QueueItem } from "../types/queue";

const movie = (key: string): QueueItem => ({
  ratingKey: key,
  title: `Movie ${key}`,
  subtitle: "",
  thumb: "/t",
  duration: 5_400_000,
  type: "movie",
});

const episode = (key: string): QueueItem => ({
  ratingKey: key,
  title: "Show",
  subtitle: `S01E0${key}`,
  thumb: "/t",
  duration: 1_800_000,
  type: "episode",
});

const emptyQueue: PlaybackQueue = { items: [], currentIndex: -1 };

describe("hasNextItem (PostPlay gate)", () => {
  describe("standalone movie (prexu-3z9 regression)", () => {
    it("returns false for a movie with no queue", () => {
      expect(
        hasNextItem({
          itemType: "movie",
          ratingKey: "m1",
          queue: emptyQueue,
          hasPlexNextEpisode: false,
        }),
      ).toBe(false);
    });

    it("returns false for a movie when ONLY a stale auto-episodes queue exists", () => {
      // User watched an episode earlier, useQueueAutoPopulate left a queue
      // tagged "auto-episodes" in localStorage. Now they launch a movie.
      const stale: PlaybackQueue = {
        items: [episode("e1"), episode("e2"), episode("e3")],
        currentIndex: 0,
        source: "auto-episodes",
      };
      expect(
        hasNextItem({
          itemType: "movie",
          ratingKey: "m1",
          queue: stale,
          hasPlexNextEpisode: false,
        }),
      ).toBe(false);
    });

    it("returns false for a movie when a user-built queue exists but the movie isn't the current item", () => {
      // Defensive: previous Play All session left a user-built queue.
      // User then launched a different movie directly (not from the queue).
      const stale: PlaybackQueue = {
        items: [movie("m_old1"), movie("m_old2")],
        currentIndex: 0,
        source: "user-built",
      };
      expect(
        hasNextItem({
          itemType: "movie",
          ratingKey: "m_fresh",
          queue: stale,
          hasPlexNextEpisode: false,
        }),
      ).toBe(false);
    });
  });

  describe("movie inside a user-built playlist (prexu-9yn)", () => {
    it("returns true when a movie is the current user-built queue item with another after it", () => {
      const queue: PlaybackQueue = {
        items: [movie("m1"), movie("m2")],
        currentIndex: 0,
        source: "user-built",
      };
      expect(
        hasNextItem({
          itemType: "movie",
          ratingKey: "m1",
          queue,
          hasPlexNextEpisode: false,
        }),
      ).toBe(true);
    });

    it("returns false when the movie is the LAST item in a user-built queue", () => {
      const queue: PlaybackQueue = {
        items: [movie("m1"), movie("m2")],
        currentIndex: 1,
        source: "user-built",
      };
      expect(
        hasNextItem({
          itemType: "movie",
          ratingKey: "m2",
          queue,
          hasPlexNextEpisode: false,
        }),
      ).toBe(false);
    });

    it("returns true for a mixed-type user-built playlist (movie followed by episode)", () => {
      const queue: PlaybackQueue = {
        items: [movie("m1"), episode("e1")],
        currentIndex: 0,
        source: "user-built",
      };
      expect(
        hasNextItem({
          itemType: "movie",
          ratingKey: "m1",
          queue,
          hasPlexNextEpisode: false,
        }),
      ).toBe(true);
    });
  });

  describe("episode (existing behavior, unchanged)", () => {
    it("returns true when an auto-episodes queue has a next item", () => {
      const queue: PlaybackQueue = {
        items: [episode("e1"), episode("e2")],
        currentIndex: 0,
        source: "auto-episodes",
      };
      expect(
        hasNextItem({
          itemType: "episode",
          ratingKey: "e1",
          queue,
          hasPlexNextEpisode: false,
        }),
      ).toBe(true);
    });

    it("returns true when queue is empty but Plex episode-nav has a next ep", () => {
      expect(
        hasNextItem({
          itemType: "episode",
          ratingKey: "e1",
          queue: emptyQueue,
          hasPlexNextEpisode: true,
        }),
      ).toBe(true);
    });

    it("returns false for the final episode of a season with empty queue and no Plex next", () => {
      const queue: PlaybackQueue = {
        items: [episode("e1")],
        currentIndex: 0,
        source: "auto-episodes",
      };
      expect(
        hasNextItem({
          itemType: "episode",
          ratingKey: "e1",
          queue,
          hasPlexNextEpisode: false,
        }),
      ).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns false for a single-item user-built queue (nothing after)", () => {
      const queue: PlaybackQueue = {
        items: [movie("m1")],
        currentIndex: 0,
        source: "user-built",
      };
      expect(
        hasNextItem({
          itemType: "movie",
          ratingKey: "m1",
          queue,
          hasPlexNextEpisode: false,
        }),
      ).toBe(false);
    });

    it("returns false when itemType is undefined and queue is empty", () => {
      expect(
        hasNextItem({
          itemType: undefined,
          ratingKey: "x",
          queue: emptyQueue,
          hasPlexNextEpisode: false,
        }),
      ).toBe(false);
    });

    it("treats a queue with no source field as not-user-built (back-compat with persisted localStorage queues)", () => {
      // Older Prexu versions persisted queues without a source field.
      // Movies playing against such a queue must NOT pop PostPlay.
      const legacy: PlaybackQueue = {
        items: [movie("m1"), movie("m2")],
        currentIndex: 0,
        // source omitted on purpose
      };
      expect(
        hasNextItem({
          itemType: "movie",
          ratingKey: "m1",
          queue: legacy,
          hasPlexNextEpisode: false,
        }),
      ).toBe(false);
    });
  });
});
