import { describe, it, expect, beforeEach } from "vitest";
import { resetIdCounter, createPlexMovie, createPlexEpisode, createPlexShow, createPlexMediaItem } from "../__tests__/mocks/plex-data";
import {
  getMediaTitle,
  getMediaSubtitle,
  getMediaSubtitleShort,
  getMediaPoster,
  getProgress,
  isWatched,
  getUnwatchedCount,
  formatResumeTime,
  decodeHtmlEntities,
} from "./media-helpers";

describe("media-helpers", () => {
  beforeEach(() => resetIdCounter());

  /* ------------------------------------------------------------------ */
  /*  getMediaTitle                                                      */
  /* ------------------------------------------------------------------ */

  describe("getMediaTitle", () => {
    it("returns title for movies", () => {
      const movie = createPlexMovie({ title: "Inception" });
      expect(getMediaTitle(movie)).toBe("Inception");
    });

    it("returns grandparentTitle for episodes", () => {
      const ep = createPlexEpisode({ grandparentTitle: "Breaking Bad", title: "Pilot" });
      expect(getMediaTitle(ep)).toBe("Breaking Bad");
    });

    it("falls back to title when episode has no grandparentTitle", () => {
      const ep = createPlexEpisode({ grandparentTitle: "", title: "Pilot" });
      expect(getMediaTitle(ep)).toBe("Pilot");
    });

    it("returns title for shows", () => {
      const show = createPlexShow({ title: "The Wire" });
      expect(getMediaTitle(show)).toBe("The Wire");
    });

    it("returns title for generic media items", () => {
      const item = createPlexMediaItem({ title: "Some Item" });
      expect(getMediaTitle(item)).toBe("Some Item");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getMediaSubtitle                                                   */
  /* ------------------------------------------------------------------ */

  describe("getMediaSubtitle", () => {
    it("returns episode code with title for episodes", () => {
      const ep = createPlexEpisode({ parentIndex: 1, index: 5, title: "Ep Title" });
      expect(getMediaSubtitle(ep)).toBe("S01E05 · Ep Title");
    });

    it("zero-pads single-digit season and episode numbers", () => {
      const ep = createPlexEpisode({ parentIndex: 3, index: 9 });
      expect(getMediaSubtitle(ep)).toMatch(/^S03E09/);
    });

    it("handles double-digit season and episode numbers", () => {
      const ep = createPlexEpisode({ parentIndex: 12, index: 24, title: "Finale" });
      expect(getMediaSubtitle(ep)).toBe("S12E24 · Finale");
    });

    it("returns only episode code when episode has no title", () => {
      const ep = createPlexEpisode({ parentIndex: 1, index: 3, title: "" });
      expect(getMediaSubtitle(ep)).toBe("S01E03");
    });

    it("returns year for movies", () => {
      const movie = createPlexMovie({ year: 2024 });
      expect(getMediaSubtitle(movie)).toBe("2024");
    });

    it("returns empty string for movies without year", () => {
      const movie = createPlexMovie({ year: undefined as unknown as number });
      expect(getMediaSubtitle(movie)).toBe("");
    });

    it("returns year for shows without showEpisodeCount option", () => {
      const show = createPlexShow({ year: 2024, leafCount: 30 });
      expect(getMediaSubtitle(show)).toBe("2024");
    });

    it("returns year and episode count for shows with showEpisodeCount", () => {
      const show = createPlexShow({ year: 2024, leafCount: 24 });
      expect(getMediaSubtitle(show, { showEpisodeCount: true })).toBe("2024 · 24 eps");
    });

    it("returns only episode count when show has no year with showEpisodeCount", () => {
      const show = createPlexShow({ year: undefined as unknown as number, leafCount: 12 });
      expect(getMediaSubtitle(show, { showEpisodeCount: true })).toBe("12 eps");
    });

    it("returns only year when show has no leafCount with showEpisodeCount", () => {
      const show = createPlexShow({ year: 2020, leafCount: 0 });
      expect(getMediaSubtitle(show, { showEpisodeCount: true })).toBe("2020");
    });

    it("returns empty string for show with no year and no leafCount with showEpisodeCount", () => {
      const show = createPlexShow({ year: undefined as unknown as number, leafCount: 0 });
      expect(getMediaSubtitle(show, { showEpisodeCount: true })).toBe("");
    });

    it("returns empty string for generic items without year", () => {
      const item = createPlexMediaItem({});
      expect(getMediaSubtitle(item)).toBe("");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getMediaSubtitleShort                                              */
  /* ------------------------------------------------------------------ */

  describe("getMediaSubtitleShort", () => {
    it("returns episode code without title for episodes", () => {
      const ep = createPlexEpisode({ parentIndex: 2, index: 10, title: "Should Not Appear" });
      expect(getMediaSubtitleShort(ep)).toBe("S02E10");
    });

    it("returns year for movies", () => {
      const movie = createPlexMovie({ year: 1999 });
      expect(getMediaSubtitleShort(movie)).toBe("1999");
    });

    it("returns empty string for items without year", () => {
      const item = createPlexMediaItem({});
      expect(getMediaSubtitleShort(item)).toBe("");
    });

    it("zero-pads episode code correctly", () => {
      const ep = createPlexEpisode({ parentIndex: 1, index: 1 });
      expect(getMediaSubtitleShort(ep)).toBe("S01E01");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getMediaPoster                                                     */
  /* ------------------------------------------------------------------ */

  describe("getMediaPoster", () => {
    it("returns grandparentThumb for episodes when available", () => {
      const ep = createPlexEpisode({ grandparentThumb: "/show/poster" });
      expect(getMediaPoster(ep)).toBe("/show/poster");
    });

    it("falls back to episode thumb when grandparentThumb is empty", () => {
      const ep = createPlexEpisode({ grandparentThumb: "", thumb: "/ep/still" });
      expect(getMediaPoster(ep)).toBe("/ep/still");
    });

    it("returns thumb for movies", () => {
      const movie = createPlexMovie({ thumb: "/movie/poster" });
      expect(getMediaPoster(movie)).toBe("/movie/poster");
    });

    it("returns thumb for shows", () => {
      const show = createPlexShow({ thumb: "/show/thumb" });
      expect(getMediaPoster(show)).toBe("/show/thumb");
    });

    it("returns thumb for generic media items", () => {
      const item = createPlexMediaItem({ thumb: "/generic/thumb" });
      expect(getMediaPoster(item)).toBe("/generic/thumb");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getProgress                                                        */
  /* ------------------------------------------------------------------ */

  describe("getProgress", () => {
    it("returns progress ratio when viewOffset and duration are set", () => {
      const movie = createPlexMovie({ viewOffset: 3600000, duration: 7200000 });
      expect(getProgress(movie)).toBe(0.5);
    });

    it("returns undefined when viewOffset is missing", () => {
      const movie = createPlexMovie({ duration: 7200000 });
      expect(getProgress(movie)).toBeUndefined();
    });

    it("returns undefined when duration is missing", () => {
      const item = createPlexMediaItem({});
      expect(getProgress(item)).toBeUndefined();
    });

    it("returns undefined when viewOffset is zero", () => {
      const movie = createPlexMovie({ viewOffset: 0, duration: 7200000 });
      expect(getProgress(movie)).toBeUndefined();
    });

    it("handles small progress values", () => {
      const movie = createPlexMovie({ viewOffset: 1000, duration: 7200000 });
      expect(getProgress(movie)).toBeCloseTo(1000 / 7200000);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  isWatched                                                          */
  /* ------------------------------------------------------------------ */

  describe("isWatched", () => {
    it("returns true for movies with viewCount > 0", () => {
      const movie = createPlexMovie({ viewCount: 1 });
      expect(isWatched(movie)).toBe(true);
    });

    it("returns false for movies with viewCount of 0", () => {
      const movie = createPlexMovie({ viewCount: 0 });
      expect(isWatched(movie)).toBe(false);
    });

    it("returns true for shows with all episodes watched", () => {
      const show = createPlexShow({ leafCount: 10, viewedLeafCount: 10 });
      expect(isWatched(show)).toBe(true);
    });

    it("returns false for shows with some unwatched episodes", () => {
      const show = createPlexShow({ leafCount: 10, viewedLeafCount: 5 });
      expect(isWatched(show)).toBe(false);
    });

    it("returns false for shows with zero leafCount", () => {
      const show = createPlexShow({ leafCount: 0, viewedLeafCount: 0 });
      expect(isWatched(show)).toBe(false);
    });

    it("returns false for generic items without watch fields", () => {
      const item = createPlexMediaItem({});
      expect(isWatched(item)).toBe(false);
    });

    it("returns true for shows with viewedLeafCount exceeding leafCount", () => {
      const show = createPlexShow({ leafCount: 10, viewedLeafCount: 12 });
      expect(isWatched(show)).toBe(true);
    });

    it("returns false for shows with viewCount but unwatched episodes", () => {
      // Plex sets viewCount on shows when any episode is watched,
      // but that doesn't mean all episodes are watched
      const show = createPlexShow({ viewCount: 5, leafCount: 164, viewedLeafCount: 46 });
      expect(isWatched(show)).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getUnwatchedCount                                                  */
  /* ------------------------------------------------------------------ */

  describe("getUnwatchedCount", () => {
    it("returns unwatched count for partially watched shows", () => {
      const show = createPlexShow({ leafCount: 24, viewedLeafCount: 10 });
      expect(getUnwatchedCount(show)).toBe(14);
    });

    it("returns undefined when all episodes are watched", () => {
      const show = createPlexShow({ leafCount: 10, viewedLeafCount: 10 });
      expect(getUnwatchedCount(show)).toBeUndefined();
    });

    it("returns undefined when viewedLeafCount exceeds leafCount", () => {
      const show = createPlexShow({ leafCount: 10, viewedLeafCount: 12 });
      expect(getUnwatchedCount(show)).toBeUndefined();
    });

    it("returns undefined for items without leaf count fields", () => {
      const item = createPlexMediaItem({});
      expect(getUnwatchedCount(item)).toBeUndefined();
    });

    it("returns leafCount when nothing has been watched", () => {
      const show = createPlexShow({ leafCount: 20, viewedLeafCount: 0 });
      expect(getUnwatchedCount(show)).toBe(20);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  formatResumeTime                                                   */
  /* ------------------------------------------------------------------ */

  describe("formatResumeTime", () => {
    it("formats time under an hour as MM:SS", () => {
      // 5 minutes 30 seconds = 330000ms
      expect(formatResumeTime(330000)).toBe("5:30");
    });

    it("formats time over an hour as HH:MM:SS", () => {
      // 1 hour 23 minutes 45 seconds = 5025000ms
      expect(formatResumeTime(5025000)).toBe("1:23:45");
    });

    it("formats zero milliseconds", () => {
      expect(formatResumeTime(0)).toBe("0:00");
    });

    it("pads seconds with leading zero", () => {
      // 1 minute 5 seconds = 65000ms
      expect(formatResumeTime(65000)).toBe("1:05");
    });

    it("pads minutes with leading zero in HH:MM:SS format", () => {
      // 1 hour 2 minutes 3 seconds = 3723000ms
      expect(formatResumeTime(3723000)).toBe("1:02:03");
    });

    it("handles exact hour boundary", () => {
      // 1 hour = 3600000ms
      expect(formatResumeTime(3600000)).toBe("1:00:00");
    });

    it("handles large values correctly", () => {
      // 10 hours = 36000000ms
      expect(formatResumeTime(36000000)).toBe("10:00:00");
    });

    it("truncates sub-second precision", () => {
      // 999ms should be 0:00
      expect(formatResumeTime(999)).toBe("0:00");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  decodeHtmlEntities                                                 */
  /* ------------------------------------------------------------------ */

  describe("decodeHtmlEntities", () => {
    it("decodes &amp; to &", () => {
      expect(decodeHtmlEntities("Cheech &amp; Chong")).toBe("Cheech & Chong");
    });

    it("decodes &lt; and &gt;", () => {
      expect(decodeHtmlEntities("a &lt; b &gt; c")).toBe("a < b > c");
    });

    it("decodes &quot; and &apos;", () => {
      expect(decodeHtmlEntities("&quot;hello&quot; &apos;world&apos;")).toBe(
        '"hello" \'world\''
      );
    });

    it("decodes numeric entities", () => {
      expect(decodeHtmlEntities("&#38; &#60;")).toBe("& <");
    });

    it("decodes hex entities", () => {
      expect(decodeHtmlEntities("&#x26; &#x3C;")).toBe("& <");
    });

    it("decodes typographic entities", () => {
      expect(decodeHtmlEntities("&ndash; &mdash; &hellip;")).toBe(
        "\u2013 \u2014 \u2026"
      );
    });

    it("returns plain text unchanged", () => {
      const plain = "No entities here!";
      expect(decodeHtmlEntities(plain)).toBe(plain);
    });

    it("leaves unknown entities unchanged", () => {
      expect(decodeHtmlEntities("&foobar;")).toBe("&foobar;");
    });

    it("handles multiple entities in one string", () => {
      expect(decodeHtmlEntities("A &amp; B &amp; C")).toBe("A & B & C");
    });
  });
});
