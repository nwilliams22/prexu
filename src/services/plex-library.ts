/**
 * Plex library API functions.
 *
 * All functions take serverUri + serverToken explicitly and delegate
 * to the existing serverFetch helper from plex-api.ts.
 */

import { serverFetch, getServerHeaders } from "./plex-api";
import type {
  LibrarySection,
  PlexMediaContainer,
  PlexMediaItem,
  PlexEpisode,
  PlexSeason,
  PaginatedResult,
  PlexHub,
  LibraryFilters,
  FilterOption,
  PlexCollection,
  PlexPlaylist,
} from "../types/library";

// ── JSON fetch helper ──

async function fetchJson<T>(
  serverUri: string,
  serverToken: string,
  path: string
): Promise<T> {
  const response = await serverFetch(serverUri, serverToken, path);
  if (!response.ok) {
    throw new Error(
      `Plex API error: ${response.status} ${response.statusText}`
    );
  }
  return response.json() as Promise<T>;
}

// ── Library Sections ──

export async function getLibrarySections(
  serverUri: string,
  serverToken: string
): Promise<LibrarySection[]> {
  const data = await fetchJson<PlexMediaContainer<never>>(
    serverUri,
    serverToken,
    "/library/sections"
  );
  return data.MediaContainer.Directory ?? [];
}

// ── Library Items (paginated) ──

export async function getLibraryItems(
  serverUri: string,
  serverToken: string,
  sectionId: string,
  options: {
    start?: number;
    size?: number;
    sort?: string;
    type?: number;
    filters?: LibraryFilters;
  } = {}
): Promise<PaginatedResult<PlexMediaItem>> {
  const params = new URLSearchParams();
  if (options.start !== undefined)
    params.set("X-Plex-Container-Start", String(options.start));
  if (options.size !== undefined)
    params.set("X-Plex-Container-Size", String(options.size));
  if (options.sort) params.set("sort", options.sort);
  if (options.type) params.set("type", String(options.type));

  // Apply filters
  if (options.filters?.genre) params.set("genre", options.filters.genre);
  if (options.filters?.year) params.set("year", options.filters.year);
  if (options.filters?.contentRating)
    params.set("contentRating", options.filters.contentRating);
  if (options.filters?.unwatched) {
    // Movies use `unwatched=1`; shows/seasons use `unwatchedLeaves=1`
    if (options.filters.sectionType === "show") {
      params.set("unwatchedLeaves", "1");
    } else {
      params.set("unwatched", "1");
    }
  }

  const query = params.toString();
  const path = `/library/sections/${sectionId}/all${query ? `?${query}` : ""}`;

  const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
    serverUri,
    serverToken,
    path
  );

  const mc = data.MediaContainer;
  const items = mc.Metadata ?? [];
  const totalSize = mc.totalSize ?? mc.size;
  const offset = mc.offset ?? 0;

  return {
    items,
    totalSize,
    offset,
    hasMore: offset + items.length < totalSize,
  };
}

// ── Filter Options ──

export async function getFilterOptions(
  serverUri: string,
  serverToken: string,
  sectionId: string,
  filterType: "genre" | "year" | "contentRating"
): Promise<FilterOption[]> {
  const data = await fetchJson<PlexMediaContainer<never>>(
    serverUri,
    serverToken,
    `/library/sections/${sectionId}/${filterType}`
  );
  return (
    (data.MediaContainer.Directory as unknown as { key: string; title: string }[]) ?? []
  ).map((d) => ({ key: d.key, title: d.title }));
}

// ── Item Detail ──

export async function getItemMetadata<T extends PlexMediaItem>(
  serverUri: string,
  serverToken: string,
  ratingKey: string
): Promise<T> {
  const data = await fetchJson<PlexMediaContainer<T>>(
    serverUri,
    serverToken,
    `/library/metadata/${ratingKey}`
  );
  const items = data.MediaContainer.Metadata;
  if (!items || items.length === 0) {
    throw new Error(`No metadata found for ratingKey ${ratingKey}`);
  }
  return items[0];
}

// ── Children (seasons of show, episodes of season) ──

export async function getItemChildren<T extends PlexMediaItem>(
  serverUri: string,
  serverToken: string,
  ratingKey: string
): Promise<T[]> {
  const data = await fetchJson<PlexMediaContainer<T>>(
    serverUri,
    serverToken,
    `/library/metadata/${ratingKey}/children`
  );
  return data.MediaContainer.Metadata ?? [];
}

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
      const result = await getLibraryItems(serverUri, serverToken, section.key, {
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

    if (currentSeasonIdx >= 0 && currentSeasonIdx < seasons.length - 1) {
      const nextSeason = seasons[currentSeasonIdx + 1];
      const nextSeasonEpisodes = await getItemChildren<PlexEpisode>(
        serverUri,
        serverToken,
        nextSeason.ratingKey
      );
      if (nextSeasonEpisodes.length > 0) {
        return nextSeasonEpisodes[0];
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ── Watch History ──

export async function getWatchHistory(
  serverUri: string,
  serverToken: string,
  options: { start?: number; size?: number; accountID?: number } = {}
): Promise<PaginatedResult<PlexMediaItem>> {
  const params = new URLSearchParams();
  params.set("sort", "viewedAt:desc");
  if (options.start !== undefined)
    params.set("X-Plex-Container-Start", String(options.start));
  if (options.size !== undefined)
    params.set("X-Plex-Container-Size", String(options.size));
  if (options.accountID !== undefined)
    params.set("accountID", String(options.accountID));

  const path = `/status/sessions/history/all?${params.toString()}`;

  const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
    serverUri,
    serverToken,
    path
  );

  const mc = data.MediaContainer;
  const items = mc.Metadata ?? [];
  const totalSize = mc.totalSize ?? mc.size;
  const offset = mc.offset ?? 0;

  return {
    items,
    totalSize,
    offset,
    hasMore: offset + items.length < totalSize,
  };
}

// ── Collections ──

export async function getCollections(
  serverUri: string,
  serverToken: string,
  sectionId: string
): Promise<PlexCollection[]> {
  const data = await fetchJson<PlexMediaContainer<PlexCollection>>(
    serverUri,
    serverToken,
    `/library/sections/${sectionId}/collections`
  );
  return data.MediaContainer.Metadata ?? [];
}

export async function getCollectionItems(
  serverUri: string,
  serverToken: string,
  collectionKey: string,
  options: { start?: number; size?: number } = {}
): Promise<PaginatedResult<PlexMediaItem>> {
  const params = new URLSearchParams();
  if (options.start !== undefined)
    params.set("X-Plex-Container-Start", String(options.start));
  if (options.size !== undefined)
    params.set("X-Plex-Container-Size", String(options.size));

  const query = params.toString();
  const path = `/library/collections/${collectionKey}/children${query ? `?${query}` : ""}`;

  const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
    serverUri,
    serverToken,
    path
  );

  const mc = data.MediaContainer;
  const items = mc.Metadata ?? [];
  const totalSize = mc.totalSize ?? mc.size;
  const offset = mc.offset ?? 0;

  return {
    items,
    totalSize,
    offset,
    hasMore: offset + items.length < totalSize,
  };
}

// ── Playlists ──

export async function getPlaylists(
  serverUri: string,
  serverToken: string
): Promise<PlexPlaylist[]> {
  const data = await fetchJson<PlexMediaContainer<PlexPlaylist>>(
    serverUri,
    serverToken,
    "/playlists"
  );
  return data.MediaContainer.Metadata ?? [];
}

export async function getPlaylistItems(
  serverUri: string,
  serverToken: string,
  playlistKey: string,
  options: { start?: number; size?: number } = {}
): Promise<PaginatedResult<PlexMediaItem>> {
  const params = new URLSearchParams();
  if (options.start !== undefined)
    params.set("X-Plex-Container-Start", String(options.start));
  if (options.size !== undefined)
    params.set("X-Plex-Container-Size", String(options.size));

  const query = params.toString();
  const path = `/playlists/${playlistKey}/items${query ? `?${query}` : ""}`;

  const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
    serverUri,
    serverToken,
    path
  );

  const mc = data.MediaContainer;
  const items = mc.Metadata ?? [];
  const totalSize = mc.totalSize ?? mc.size;
  const offset = mc.offset ?? 0;

  return {
    items,
    totalSize,
    offset,
    hasMore: offset + items.length < totalSize,
  };
}

// ── Playlist Mutations ──

/** Add an item to an existing playlist */
export async function addToPlaylist(
  serverUri: string,
  serverToken: string,
  playlistId: string,
  ratingKey: string,
  machineIdentifier: string
): Promise<void> {
  const uri = `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${ratingKey}`;
  const headers = await getServerHeaders(serverToken);
  const response = await fetch(
    `${serverUri}/playlists/${playlistId}/items?uri=${encodeURIComponent(uri)}`,
    { method: "PUT", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to add to playlist: ${response.status}`);
  }
}

/** Create a new playlist with an initial item */
export async function createPlaylist(
  serverUri: string,
  serverToken: string,
  title: string,
  ratingKey: string,
  machineIdentifier: string
): Promise<PlexPlaylist> {
  const uri = `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${ratingKey}`;
  const params = new URLSearchParams({
    type: "video",
    title,
    smart: "0",
    uri,
  });
  const headers = await getServerHeaders(serverToken);
  const response = await fetch(
    `${serverUri}/playlists?${params.toString()}`,
    { method: "POST", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to create playlist: ${response.status}`);
  }
  const data = await response.json();
  return data.MediaContainer.Metadata[0];
}

// ── Related Items ──

export async function getRelatedItems(
  serverUri: string,
  serverToken: string,
  ratingKey: string
): Promise<PlexMediaItem[]> {
  const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
    serverUri,
    serverToken,
    `/library/metadata/${ratingKey}/related`
  );
  return data.MediaContainer.Metadata ?? [];
}

// ── Extras (trailers, behind-the-scenes, etc.) ──

export async function getExtras(
  serverUri: string,
  serverToken: string,
  ratingKey: string
): Promise<PlexMediaItem[]> {
  const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
    serverUri,
    serverToken,
    `/library/metadata/${ratingKey}/extras`
  );
  return data.MediaContainer.Metadata ?? [];
}

// ── Search ──

export async function searchLibrary(
  serverUri: string,
  serverToken: string,
  query: string,
  limit: number = 10
): Promise<PlexHub[]> {
  const params = new URLSearchParams({ query, limit: String(limit) });
  const data = await fetchJson<PlexMediaContainer<never>>(
    serverUri,
    serverToken,
    `/hubs/search?${params.toString()}`
  );
  return data.MediaContainer.Hub ?? [];
}

// ── Image URL Construction ──

export function getImageUrl(
  serverUri: string,
  serverToken: string,
  imagePath: string,
  width: number,
  height: number
): string {
  if (!imagePath) return "";
  const params = new URLSearchParams({
    url: imagePath,
    width: String(width),
    height: String(height),
    minSize: "1",
    upscale: "1",
    "X-Plex-Token": serverToken,
  });
  return `${serverUri}/photo/:/transcode?${params.toString()}`;
}

// ── Scrobble / Unscrobble (Mark Watched / Unwatched) ──

export async function markAsWatched(
  serverUri: string,
  serverToken: string,
  ratingKey: string
): Promise<void> {
  const response = await serverFetch(
    serverUri,
    serverToken,
    `/:/scrobble?identifier=com.plexapp.plugins.library&key=${ratingKey}`
  );
  if (!response.ok) {
    throw new Error(`Failed to mark as watched: ${response.status}`);
  }
}

export async function markAsUnwatched(
  serverUri: string,
  serverToken: string,
  ratingKey: string
): Promise<void> {
  const response = await serverFetch(
    serverUri,
    serverToken,
    `/:/unscrobble?identifier=com.plexapp.plugins.library&key=${ratingKey}`
  );
  if (!response.ok) {
    throw new Error(`Failed to mark as unwatched: ${response.status}`);
  }
}

// ── Library Section Management ──

export async function scanLibrary(
  serverUri: string,
  serverToken: string,
  sectionId: string
): Promise<void> {
  const response = await serverFetch(
    serverUri,
    serverToken,
    `/library/sections/${sectionId}/refresh`
  );
  if (!response.ok) {
    throw new Error(`Failed to scan library: ${response.status}`);
  }
}

export async function refreshLibraryMetadata(
  serverUri: string,
  serverToken: string,
  sectionId: string
): Promise<void> {
  const headers = await getServerHeaders(serverToken);
  const response = await fetch(
    `${serverUri}/library/sections/${sectionId}/refresh?force=1`,
    { method: "PUT", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to refresh metadata: ${response.status}`);
  }
}

export async function emptyLibraryTrash(
  serverUri: string,
  serverToken: string,
  sectionId: string
): Promise<void> {
  const headers = await getServerHeaders(serverToken);
  const response = await fetch(
    `${serverUri}/library/sections/${sectionId}/emptyTrash`,
    { method: "PUT", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to empty trash: ${response.status}`);
  }
}
