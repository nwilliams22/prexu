/**
 * Item metadata and children (seasons/episodes) fetching.
 */

import { fetchJson } from "./base";
import type { PlexMediaContainer, PlexMediaItem } from "../../types/library";

// ── Item Detail ──

export async function getItemMetadata<T extends PlexMediaItem>(
  serverUri: string,
  serverToken: string,
  ratingKey: string
): Promise<T> {
  const data = await fetchJson<PlexMediaContainer<T>>(
    serverUri,
    serverToken,
    `/library/metadata/${ratingKey}?includeRatings=1`
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
