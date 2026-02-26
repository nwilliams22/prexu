import type {
  PlexMediaItem,
  PlexMovie,
  PlexEpisode,
  GroupedRecentItem,
} from "../types/library";

/**
 * Groups recently added items so that TV episodes from the same show
 * are collapsed into a single card, while movies remain individual.
 *
 * The group's position in the list is determined by the first episode
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
    }
    // Skip seasons, clips, and other types
  }

  return result;
}
