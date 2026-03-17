/**
 * Collection listing and item fetching.
 */

import { fetchJson } from "./base";
import type {
  PlexMediaContainer,
  PlexMediaItem,
  PlexCollection,
  PaginatedResult,
} from "../../types/library";

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
