/**
 * Episode navigation: next/previous episode resolution.
 */

import { getItemChildren } from "./detail";
import type { PlexEpisode, PlexSeason } from "../../types/library";

// ── Next Episode ──

/**
 * Finds the next episode after the given one.
 * Checks the same season first, then the first episode of the next season.
 */
export async function getNextEpisode(
  serverUri: string,
  serverToken: string,
  currentEpisode: PlexEpisode
): Promise<PlexEpisode | null> {
  try {
    // Fetch all episodes in the current season
    const episodes = await getItemChildren<PlexEpisode>(
      serverUri,
      serverToken,
      currentEpisode.parentRatingKey
    );

    // Find the next episode by index
    const nextInSeason = episodes.find(
      (ep) => ep.index === currentEpisode.index + 1
    );
    if (nextInSeason) return nextInSeason;

    // If no next in season, look for the next season
    const seasons = await getItemChildren<PlexSeason>(
      serverUri,
      serverToken,
      currentEpisode.grandparentRatingKey
    );

    const currentSeasonIdx = seasons.findIndex(
      (s) => s.ratingKey === currentEpisode.parentRatingKey
    );

    const nextSeason =
      currentSeasonIdx >= 0 && currentSeasonIdx < seasons.length - 1
        ? seasons[currentSeasonIdx + 1]
        : undefined;
    if (nextSeason) {
      const nextSeasonEpisodes = await getItemChildren<PlexEpisode>(
        serverUri,
        serverToken,
        nextSeason.ratingKey
      );
      return nextSeasonEpisodes[0] ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

// ── Previous Episode ──

/**
 * Finds the previous episode before the given one.
 * Checks the same season first, then the last episode of the previous season.
 */
export async function getPreviousEpisode(
  serverUri: string,
  serverToken: string,
  currentEpisode: PlexEpisode
): Promise<PlexEpisode | null> {
  try {
    // Fetch all episodes in the current season
    const episodes = await getItemChildren<PlexEpisode>(
      serverUri,
      serverToken,
      currentEpisode.parentRatingKey
    );

    // Find the previous episode by index
    const prevInSeason = episodes.find(
      (ep) => ep.index === currentEpisode.index - 1
    );
    if (prevInSeason) return prevInSeason;

    // If no previous in season, look for the previous season
    const seasons = await getItemChildren<PlexSeason>(
      serverUri,
      serverToken,
      currentEpisode.grandparentRatingKey
    );

    const currentSeasonIdx = seasons.findIndex(
      (s) => s.ratingKey === currentEpisode.parentRatingKey
    );

    const prevSeason = currentSeasonIdx > 0 ? seasons[currentSeasonIdx - 1] : undefined;
    if (prevSeason) {
      const prevSeasonEpisodes = await getItemChildren<PlexEpisode>(
        serverUri,
        serverToken,
        prevSeason.ratingKey
      );
      if (prevSeasonEpisodes.length > 0) {
        return prevSeasonEpisodes[prevSeasonEpisodes.length - 1] ?? null;
      }
    }

    return null;
  } catch {
    return null;
  }
}
