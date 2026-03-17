/**
 * Watch history fetching.
 */

import { fetchJson } from "./base";
import type { PlexMediaContainer, PlexMediaItem, PaginatedResult } from "../../types/library";

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
