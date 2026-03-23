export interface QueueItem {
  ratingKey: string;
  title: string;
  subtitle: string; // e.g., "S01E02 · Episode Title"
  thumb: string;
  duration: number; // milliseconds
  type: "movie" | "episode";
}

export interface PlaybackQueue {
  items: QueueItem[];
  currentIndex: number;
  shuffled?: boolean;
}
