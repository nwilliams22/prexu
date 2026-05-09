/**
 * Pure helper that decides whether the PostPlay overlay should fire when
 * the currently playing item ends — i.e. whether a "logical next" exists.
 *
 * Three sources of "next":
 *   1. Episode + queue has next (auto-populated sibling episodes)
 *   2. Episode + Plex's adjacent-episode API has a next ep
 *   3. ANY type + queue.source === "user-built" with another item next AND
 *      the currently playing item is the queue's current entry
 *      (prexu-9yn — movies inside an explicit playlist/collection should
 *      get PostPlay too)
 *
 * For non-episode items we additionally require the playing ratingKey to
 * be the queue's currentIndex item, so a stale user-built queue from an
 * earlier Play All can't hijack a fresh standalone movie launch.
 *
 * Extracted from Player.tsx so it can be unit-tested directly (Player.tsx
 * has too many side-effecty hook dependencies to render in jsdom).
 */

import type { PlaybackQueue } from "../types/queue";

export interface HasNextItemArgs {
  /** Currently playing item's Plex type — "movie", "episode", "track", etc. */
  itemType: string | undefined;
  /** Currently playing ratingKey (used for stale-queue safety). */
  ratingKey: string;
  /** Current playback queue (may be empty / stale / user-built / auto-episodes). */
  queue: PlaybackQueue;
  /**
   * True when Plex's adjacent-episodes API returned a non-null next.
   * Player.tsx derives this from `episodeNav.handleNextEpisode != null`.
   */
  hasPlexNextEpisode: boolean;
}

export function hasNextItem({
  itemType,
  ratingKey,
  queue,
  hasPlexNextEpisode,
}: HasNextItemArgs): boolean {
  const queueHasNext = queue.currentIndex + 1 < queue.items.length;

  // Movies / non-episodes can ONLY ride the user-built queue path. Auto-
  // populated episode queues are stale relative to a separately-launched
  // movie and must not trigger PostPlay.
  const playingFromUserBuiltQueue =
    queue.source === "user-built" &&
    queueHasNext &&
    queue.currentIndex >= 0 &&
    queue.items[queue.currentIndex]?.ratingKey === ratingKey;

  if (itemType === "episode") {
    return queueHasNext || hasPlexNextEpisode || playingFromUserBuiltQueue;
  }
  return playingFromUserBuiltQueue;
}
