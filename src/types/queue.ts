export interface QueueItem {
  ratingKey: string;
  title: string;
  subtitle: string; // e.g., "S01E02 · Episode Title"
  thumb: string;
  duration: number; // milliseconds
  type: "movie" | "episode";
}

/**
 * How the current queue was built.
 *  - "auto-episodes": populated by useQueueAutoPopulate from sibling
 *    episodes when an episode started playing. The queue is a side-effect
 *    of episode playback; movies should NOT trigger PostPlay against it
 *    (the items are stale relative to the movie the user is now watching).
 *  - "user-built": populated by an explicit user action — Play All /
 *    Shuffle on a playlist or collection. PostPlay should fire for any
 *    item type when there's another item next.
 */
export type QueueSource = "auto-episodes" | "user-built";

export interface PlaybackQueue {
  items: QueueItem[];
  currentIndex: number;
  shuffled?: boolean;
  source?: QueueSource;
}
