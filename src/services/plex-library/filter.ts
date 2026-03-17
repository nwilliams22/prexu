/**
 * Library item fetching with filter and pagination support.
 */

import { fetchJson } from "./base";
import type {
  PlexMediaContainer,
  PlexMediaItem,
  PaginatedResult,
  LibraryFilters,
  FilterOption,
} from "../../types/library";

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
