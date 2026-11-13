import type { UsePlayerResult } from "../hooks/usePlayer";

/** A duplicate queue entry is a new playthrough without a rating-key change. */
export function playQueueItem(
  nextRatingKey: string,
  currentRatingKey: string,
  player: Pick<UsePlayerResult, "seek" | "isPlaying" | "togglePlay">,
  replaceRatingKey: (ratingKey: string) => void,
): void {
  if (nextRatingKey === currentRatingKey) {
    player.seek(0);
    if (!player.isPlaying) player.togglePlay();
  } else {
    replaceRatingKey(nextRatingKey);
  }
}
