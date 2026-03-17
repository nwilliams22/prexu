/**
 * Library item listing, recently added, and on-deck.
 */

import { fetchJson } from "./base";
import { getLibraryItems as getItems } from "./filter";
import type {
  LibrarySection,
  PlexMediaContainer,
  PlexMediaItem,
} from "../../types/library";

// Re-export getLibraryItems from filter module for barrel
export { getLibraryItems } from "./filter";

// ── Recently Added ──

export async function getRecentlyAdded(
  serverUri: string,
  serverToken: string,
  limit: number = 50
): Promise<PlexMediaItem[]> {
  const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
    serverUri,
    serverToken,
    `/library/recentlyAdded?X-Plex-Container-Size=${limit}`
  );
  return data.MediaContainer.Metadata ?? [];
}

/**
 * Fetches recently added items per library section with proper type filtering.
 * For TV show libraries, returns episodes (type=4) instead of seasons.
 * For movie libraries, returns movies (type=1).
 * Results are merged and sorted by addedAt descending.
 */
export async function getRecentlyAddedBySection(
  serverUri: string,
  serverToken: string,
  sections: LibrarySection[],
  limitPerSection: number = 30
): Promise<PlexMediaItem[]> {
  const fetches = sections
    .filter((s) => s.type === "movie" || s.type === "show")
    .map(async (section) => {
      // type=1 for movies, type=4 for episodes
      const plexType = section.type === "movie" ? 1 : 4;
      const result = await getItems(serverUri, serverToken, section.key, {
        sort: "addedAt:desc",
        type: plexType,
        size: limitPerSection,
      });
      return result.items;
    });

  const results = await Promise.all(fetches);
  const merged = results.flat();

  // Sort by addedAt descending (most recent first)
  merged.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));

  return merged;
}

// ── On Deck / Continue Watching ──

export async function getOnDeck(
  serverUri: string,
  serverToken: string
): Promise<PlexMediaItem[]> {
  const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
    serverUri,
    serverToken,
    "/library/onDeck"
  );
  return data.MediaContainer.Metadata ?? [];
}
