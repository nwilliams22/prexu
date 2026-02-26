import type {
  PlexMediaItem,
  PlexMovie,
  PlexEpisode,
  PlexSeason,
  GroupedRecentItem,
} from "../types/library";

/**
 * Groups recently added items so that TV episodes/seasons from the same show
 * are collapsed into a single card, while movies remain individual.
 *
 * Handles both `type === "episode"` (episode-level data from some API
 * endpoints) and `type === "season"` (the default from /library/recentlyAdded).
 *
 * The group's position in the list is determined by the first item
 * encountered (preserves recency ordering from the API).
 */
export function groupRecentlyAdded(
  items: PlexMediaItem[]
): GroupedRecentItem[] {
  const result: GroupedRecentItem[] = [];
  const showGroupMap = new Map<string, GroupedRecentItem>();

  for (const item of items) {
    if (item.type === "movie") {
      result.push({
        kind: "movie",
        representativeItem: item as PlexMovie,
        groupKey: item.ratingKey,
        title: item.title,
        thumb: item.thumb,
        episodes: [],
        episodeCount: 0,
      });
    } else if (item.type === "episode") {
      const episode = item as PlexEpisode;
      const showKey = episode.grandparentRatingKey;

      if (showGroupMap.has(showKey)) {
        const group = showGroupMap.get(showKey)!;
        group.episodes.push(episode);
        group.episodeCount = group.episodes.length;
      } else {
        const group: GroupedRecentItem = {
          kind: "show-group",
          representativeItem: episode,
          groupKey: showKey,
          title: episode.grandparentTitle,
          thumb: episode.grandparentThumb || episode.thumb,
          episodes: [episode],
          episodeCount: 1,
        };
        showGroupMap.set(showKey, group);
        result.push(group);
      }
    } else if (item.type === "season") {
      // /library/recentlyAdded returns seasons (not episodes) for TV content.
      // Group them by show using parentRatingKey.
      const season = item as PlexSeason;
      const showKey = season.parentRatingKey;

      if (showGroupMap.has(showKey)) {
        const group = showGroupMap.get(showKey)!;
        // Accumulate episode count from this season's leafCount
        group.episodeCount += season.leafCount || 0;
      } else {
        const group: GroupedRecentItem = {
          kind: "show-group",
          representativeItem: season as unknown as PlexEpisode,
          groupKey: showKey,
          title: season.parentTitle || item.title,
          thumb: season.parentThumb || item.thumb,
          episodes: [], // No episode-level data from season items
          episodeCount: season.leafCount || 0,
        };
        showGroupMap.set(showKey, group);
        result.push(group);
      }
    }
    // Skip clips and other types
  }

  return result;
}
