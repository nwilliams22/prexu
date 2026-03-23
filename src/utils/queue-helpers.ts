import type { PlexMediaItem, PlexEpisode } from "../types/library";
import type { QueueItem } from "../types/queue";

/**
 * Convert an array of PlexMediaItem to QueueItem[],
 * filtering to only playable types (movie, episode).
 */
export function buildQueueFromItems(items: PlexMediaItem[]): QueueItem[] {
  return items
    .filter((item) => item.type === "movie" || item.type === "episode")
    .map((item) => {
      if (item.type === "episode") {
        const ep = item as PlexEpisode;
        return {
          ratingKey: ep.ratingKey,
          title: ep.grandparentTitle || ep.title,
          subtitle: `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")} · ${ep.title}`,
          thumb: ep.grandparentThumb || ep.thumb,
          duration: ep.duration ?? 0,
          type: "episode" as const,
        };
      }
      return {
        ratingKey: item.ratingKey,
        title: item.title,
        subtitle: (item as { year?: number }).year
          ? String((item as { year?: number }).year)
          : "",
        thumb: item.thumb,
        duration: (item as { duration?: number }).duration ?? 0,
        type: "movie" as const,
      };
    });
}

/** Fisher-Yates shuffle — returns a new array */
export function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
