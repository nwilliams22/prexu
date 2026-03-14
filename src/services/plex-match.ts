/**
 * Plex match/fix metadata API functions.
 * Used to search for metadata matches and apply corrections to library items.
 */

import { getServerHeaders } from "./plex-api";
import type { PlexSearchResult, PlexMatchSearchResponse } from "../types/fix-match";

/**
 * Search for metadata matches for a library item.
 * The Plex server returns a list of potential matches with confidence scores.
 */
export async function searchMatches(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
  title: string,
  year?: string,
  agent?: string,
): Promise<PlexSearchResult[]> {
  const headers = await getServerHeaders(serverToken);
  const params = new URLSearchParams({
    manual: "1",
    title,
  });

  if (year) params.set("year", year);
  if (agent) params.set("agent", agent);

  const resp = await fetch(
    `${serverUri}/library/metadata/${ratingKey}/matches?${params}`,
    { headers },
  );

  if (!resp.ok) {
    throw new Error(`Match search failed: ${resp.status} ${resp.statusText}`);
  }

  const data: PlexMatchSearchResponse = await resp.json();
  return data.MediaContainer.SearchResult ?? [];
}

/**
 * Search for metadata matches using an IMDb ID.
 * Plex supports passing IMDb IDs via the title parameter with the `imdb-` prefix.
 */
export async function searchMatchByImdb(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
  imdbId: string,
  agent?: string,
): Promise<PlexSearchResult[]> {
  // Ensure the ID has the imdb- prefix
  const prefixedId = imdbId.startsWith("imdb-") ? imdbId : `imdb-${imdbId}`;
  return searchMatches(serverUri, serverToken, ratingKey, prefixedId, undefined, agent);
}

/**
 * Apply a selected metadata match to a library item.
 * This updates the item's metadata to the selected match.
 */
export async function applyMatch(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
  guid: string,
  name: string,
  year: number,
): Promise<void> {
  const headers = await getServerHeaders(serverToken);
  const params = new URLSearchParams({
    guid,
    name,
  });

  if (year) params.set("year", String(year));

  const resp = await fetch(
    `${serverUri}/library/metadata/${ratingKey}/match?${params}`,
    { method: "PUT", headers },
  );

  if (!resp.ok) {
    throw new Error(`Apply match failed: ${resp.status} ${resp.statusText}`);
  }
}

/**
 * Refresh metadata for a library item.
 * Typically called after applying a match to pull down full metadata.
 */
export async function refreshMetadata(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
): Promise<void> {
  const headers = await getServerHeaders(serverToken);

  const resp = await fetch(
    `${serverUri}/library/metadata/${ratingKey}/refresh`,
    { method: "PUT", headers },
  );

  if (!resp.ok) {
    throw new Error(`Metadata refresh failed: ${resp.status} ${resp.statusText}`);
  }
}

/** Get the appropriate Plex agent string for a media type. */
export function getAgentForType(mediaType: string): string {
  switch (mediaType) {
    case "movie":
      return "tv.plex.agents.movie";
    case "show":
    case "episode":
    case "season":
      return "tv.plex.agents.series";
    default:
      return "tv.plex.agents.movie";
  }
}
