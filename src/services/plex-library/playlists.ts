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

/** Delete a playlist */
export async function deletePlaylist(
  serverUri: string,
  serverToken: string,
  playlistId: string
): Promise<void> {
  const headers = await getServerHeaders(serverToken);
  const response = await timedFetch(
    `${serverUri}/playlists/${playlistId}`,
    { method: "DELETE", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to delete playlist: ${response.status}`);
  }
}

/** Remove an item from a playlist by its playlistItemID */
export async function removeFromPlaylist(
  serverUri: string,
  serverToken: string,
  playlistId: string,
  playlistItemID: number
): Promise<void> {
  const headers = await getServerHeaders(serverToken);
  const response = await timedFetch(
    `${serverUri}/playlists/${playlistId}/items/${playlistItemID}`,
    { method: "DELETE", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to remove from playlist: ${response.status}`);
  }
}

/** Move a playlist item to a new position. afterId=-1 moves to first position. */
export async function movePlaylistItem(
  serverUri: string,
  serverToken: string,
  playlistId: string,
  playlistItemID: number,
  afterId: number
): Promise<void> {
  const headers = await getServerHeaders(serverToken);
  const response = await timedFetch(
    `${serverUri}/playlists/${playlistId}/items/${playlistItemID}/move?after=${afterId}`,
    { method: "PUT", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to move playlist item: ${response.status}`);
  }
}

/** Update playlist title and/or summary */
export async function updatePlaylist(
  serverUri: string,
  serverToken: string,
  playlistId: string,
  fields: { title?: string; summary?: string }
): Promise<void> {
  const params = new URLSearchParams();
  if (fields.title !== undefined) params.set("title", fields.title);
  if (fields.summary !== undefined) params.set("summary", fields.summary);
  const headers = await getServerHeaders(serverToken);
  const response = await timedFetch(
    `${serverUri}/playlists/${playlistId}?${params.toString()}`,
    { method: "PUT", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to update playlist: ${response.status}`);
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
