/**
 * Playlist listing, item fetching, and mutations.
 */

import { fetchJson } from "./base";
import { getServerHeaders, timedFetch } from "../plex-api";
import type {
  PlexMediaContainer,
  PlexMediaItem,
  PlexPlaylist,
  PaginatedResult,
} from "../../types/library";

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
  const response = await timedFetch(
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
  const response = await timedFetch(
    `${serverUri}/playlists?${params.toString()}`,
    { method: "POST", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to create playlist: ${response.status}`);
  }
  const data = await response.json();
  return data.MediaContainer.Metadata[0];
}
