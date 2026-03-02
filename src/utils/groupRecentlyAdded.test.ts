import { groupRecentlyAdded } from "./groupRecentlyAdded";
import {
  createPlexMovie,
  createPlexEpisode,
  createPlexSeason,
  createPlexMediaItem,
  resetIdCounter,
} from "../__tests__/mocks/plex-data";
import type { PlexMediaItem } from "../types/library";

describe("groupRecentlyAdded", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("returns empty array for empty input", () => {
    expect(groupRecentlyAdded([])).toEqual([]);
  });

  it("wraps a single movie as kind='movie' with episodeCount 0", () => {
    const movie = createPlexMovie({ title: "Inception" });
    const result = groupRecentlyAdded([movie]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("movie");
    expect(result[0].title).toBe("Inception");
    expect(result[0].thumb).toBe(movie.thumb);
    expect(result[0].groupKey).toBe(movie.ratingKey);
    expect(result[0].representativeItem).toBe(movie);
    expect(result[0].episodes).toEqual([]);
    expect(result[0].episodeCount).toBe(0);
  });

  it("wraps a single episode as kind='show-group' using grandparentTitle/Thumb", () => {
    const episode = createPlexEpisode({
      title: "Pilot",
      grandparentTitle: "Breaking Bad",
      grandparentRatingKey: "show-1",
      grandparentThumb: "/shows/bb/thumb",
    });
    const result = groupRecentlyAdded([episode]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("show-group");
    expect(result[0].title).toBe("Breaking Bad");
    expect(result[0].thumb).toBe("/shows/bb/thumb");
    expect(result[0].groupKey).toBe("show-1");
    expect(result[0].representativeItem).toBe(episode);
    expect(result[0].episodes).toEqual([episode]);
    expect(result[0].episodeCount).toBe(1);
  });

  it("groups multiple episodes from the same show into a single group", () => {
    const ep1 = createPlexEpisode({
      title: "Episode 1",
      grandparentRatingKey: "show-1",
      grandparentTitle: "The Wire",
      grandparentThumb: "/shows/wire/thumb",
    });
    const ep2 = createPlexEpisode({
      title: "Episode 2",
      grandparentRatingKey: "show-1",
      grandparentTitle: "The Wire",
      grandparentThumb: "/shows/wire/thumb",
    });
    const ep3 = createPlexEpisode({
      title: "Episode 3",
      grandparentRatingKey: "show-1",
      grandparentTitle: "The Wire",
      grandparentThumb: "/shows/wire/thumb",
    });

    const result = groupRecentlyAdded([ep1, ep2, ep3]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("show-group");
    expect(result[0].title).toBe("The Wire");
    expect(result[0].episodes).toEqual([ep1, ep2, ep3]);
    expect(result[0].episodeCount).toBe(3);
  });

  it("creates separate groups for episodes from different shows", () => {
    const ep1 = createPlexEpisode({
      title: "BB Pilot",
      grandparentRatingKey: "show-bb",
      grandparentTitle: "Breaking Bad",
    });
    const ep2 = createPlexEpisode({
      title: "Wire Pilot",
      grandparentRatingKey: "show-wire",
      grandparentTitle: "The Wire",
    });

    const result = groupRecentlyAdded([ep1, ep2]);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Breaking Bad");
    expect(result[1].title).toBe("The Wire");
  });

  it("handles a single season as kind='show-group' with episodeCount from leafCount", () => {
    const season = createPlexSeason({
      parentRatingKey: "show-1",
      parentTitle: "Stranger Things",
      parentThumb: "/shows/st/thumb",
      leafCount: 8,
    });

    const result = groupRecentlyAdded([season]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("show-group");
    expect(result[0].title).toBe("Stranger Things");
    expect(result[0].thumb).toBe("/shows/st/thumb");
    expect(result[0].groupKey).toBe("show-1");
    expect(result[0].episodes).toEqual([]); // seasons don't provide episode data
    expect(result[0].episodeCount).toBe(8);
  });

  it("accumulates leafCount from multiple seasons of the same show", () => {
    const s1 = createPlexSeason({
      parentRatingKey: "show-1",
      parentTitle: "Stranger Things",
      parentThumb: "/shows/st/thumb",
      leafCount: 8,
    });
    const s2 = createPlexSeason({
      parentRatingKey: "show-1",
      parentTitle: "Stranger Things",
      parentThumb: "/shows/st/thumb",
      leafCount: 9,
    });

    const result = groupRecentlyAdded([s1, s2]);

    expect(result).toHaveLength(1);
    expect(result[0].episodeCount).toBe(17); // 8 + 9
  });

  it("handles mixed movies and episodes", () => {
    const movie = createPlexMovie({ title: "Inception" });
    const ep1 = createPlexEpisode({
      title: "Pilot",
      grandparentRatingKey: "show-1",
      grandparentTitle: "Lost",
    });
    const ep2 = createPlexEpisode({
      title: "Ep 2",
      grandparentRatingKey: "show-1",
      grandparentTitle: "Lost",
    });

    const result = groupRecentlyAdded([movie, ep1, ep2]);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("movie");
    expect(result[0].title).toBe("Inception");
    expect(result[1].kind).toBe("show-group");
    expect(result[1].title).toBe("Lost");
    expect(result[1].episodeCount).toBe(2);
  });

  it("handles mixed movies, episodes, and seasons", () => {
    const movie = createPlexMovie({ title: "Interstellar" });
    const ep = createPlexEpisode({
      title: "Pilot",
      grandparentRatingKey: "show-1",
      grandparentTitle: "Lost",
    });
    const season = createPlexSeason({
      parentRatingKey: "show-2",
      parentTitle: "Friends",
      leafCount: 24,
    });

    const result = groupRecentlyAdded([movie, ep, season]);

    expect(result).toHaveLength(3);
    expect(result[0].kind).toBe("movie");
    expect(result[1].kind).toBe("show-group");
    expect(result[1].title).toBe("Lost");
    expect(result[2].kind).toBe("show-group");
    expect(result[2].title).toBe("Friends");
    expect(result[2].episodeCount).toBe(24);
  });

  it("skips unknown types (e.g., 'clip')", () => {
    const clip = createPlexMediaItem({ type: "clip", title: "Behind the scenes" });
    const movie = createPlexMovie({ title: "Matrix" });

    const result = groupRecentlyAdded([clip as PlexMediaItem, movie]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Matrix");
  });

  it("skips artist and album types", () => {
    const artist = createPlexMediaItem({ type: "artist", title: "Radiohead" });
    const album = createPlexMediaItem({ type: "album", title: "OK Computer" });

    const result = groupRecentlyAdded([artist, album]);
    expect(result).toHaveLength(0);
  });

  it("falls back to episode.thumb when grandparentThumb is empty", () => {
    const episode = createPlexEpisode({
      title: "Pilot",
      grandparentRatingKey: "show-1",
      grandparentTitle: "New Show",
      grandparentThumb: "",
      thumb: "/episodes/ep1/thumb",
    });

    const result = groupRecentlyAdded([episode]);

    expect(result[0].thumb).toBe("/episodes/ep1/thumb");
  });

  it("uses parentTitle for season title, falls back to item.title if empty", () => {
    const seasonWithParent = createPlexSeason({
      parentRatingKey: "show-1",
      parentTitle: "Breaking Bad",
    });

    const seasonWithoutParent = createPlexSeason({
      parentRatingKey: "show-2",
      parentTitle: "",
      title: "Season 1 Fallback Title",
    });

    const result = groupRecentlyAdded([seasonWithParent, seasonWithoutParent]);

    expect(result[0].title).toBe("Breaking Bad");
    expect(result[1].title).toBe("Season 1 Fallback Title");
  });

  it("preserves order — first encounter determines group position", () => {
    const ep1Show1 = createPlexEpisode({
      grandparentRatingKey: "show-A",
      grandparentTitle: "Show A",
      addedAt: 1000,
    });
    const movie = createPlexMovie({ title: "Movie B", addedAt: 999 });
    const ep2Show1 = createPlexEpisode({
      grandparentRatingKey: "show-A",
      grandparentTitle: "Show A",
      addedAt: 998,
    });

    const result = groupRecentlyAdded([ep1Show1, movie, ep2Show1]);

    // Show A should appear first because its first episode was first
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Show A");
    expect(result[1].title).toBe("Movie B");
    expect(result[0].episodeCount).toBe(2);
  });

  it("handles season with leafCount of 0", () => {
    const season = createPlexSeason({
      parentRatingKey: "show-1",
      parentTitle: "Empty Show",
      leafCount: 0,
    });

    const result = groupRecentlyAdded([season]);

    expect(result).toHaveLength(1);
    expect(result[0].episodeCount).toBe(0);
  });
});
