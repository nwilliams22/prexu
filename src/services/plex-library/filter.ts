/**
 * Library item fetching with filter and pagination support.
 */

import { fetchJson } from "./base";
import { directoryContainerSchema, safeParsePlex } from "../plex-schemas";
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
    signal?: AbortSignal;
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
  // Year range — Plex's filter query language appends the operator directly
  // to the field name and lets the mandatory `key=value` separator supply
  // the "=" half of >=/<= (so the wire pair `year>=1980` is field name
  // "year>" + value "1980"). Verified against Plex's documented filter
  // operators (`=`, `!=`, `>=`, `<=` — plexopedia.com/plex-media-server/api/filter
  // and the Arcanemagus/plex-api wiki's Plex-Web-API-Overview page both list
  // this exact syntax for numeric fields like year). `URLSearchParams`
  // percent-encodes ">"/"<" in the key, which decodes back to the same pair
  // server-side — confirmed by round-tripping through URLSearchParams here.
  if (options.filters?.yearMin) params.set("year>", options.filters.yearMin);
  if (options.filters?.yearMax) params.set("year<", options.filters.yearMax);
  if (options.filters?.contentRating)
    params.set("contentRating", options.filters.contentRating);
  if (options.filters?.resolution)
    params.set("resolution", options.filters.resolution);
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
    path,
    options.signal
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
  filterType: "genre" | "year" | "contentRating" | "resolution"
): Promise<FilterOption[]> {
  const raw = await fetchJson<unknown>(
    serverUri,
    serverToken,
    `/library/sections/${sectionId}/${filterType}`
  );
  const data = safeParsePlex(
    directoryContainerSchema,
    raw,
    "getFilterOptions",
    { MediaContainer: { Directory: [] } },
  );
  return (data.MediaContainer.Directory ?? []).map((d) => ({
    key: d.key,
    title: d.title ?? "",
  }));
}

// ── First-Character Index ──

export interface FirstCharacterBucket {
  /** The letter or "#" for non-alpha titles */
  key: string;
  /** Number of items whose sort title starts with this character */
  size: number;
}

/**
 * Fetches the per-letter item count index for a library section.
 *
 * Calls `/library/sections/{id}/firstCharacter` which Plex returns as a
 * Directory array of `{ key, size }` entries — one per distinct first
 * character of the items' sort titles. This lets the AlphaJumpBar be
 * populated without loading any actual media items.
 *
 * Returns an empty array when the server returns a non-2xx status or an
 * unexpected shape (callers should treat that as "unavailable" and fall
 * back to loading all items).
 */
export async function getSectionFirstCharacter(
  serverUri: string,
  serverToken: string,
  sectionId: string
): Promise<FirstCharacterBucket[]> {
  const raw = await fetchJson<unknown>(
    serverUri,
    serverToken,
    `/library/sections/${sectionId}/firstCharacter`
  );
  const data = safeParsePlex(
    directoryContainerSchema,
    raw,
    "getSectionFirstCharacter",
    { MediaContainer: { Directory: [] } },
  );
  const dirs = data.MediaContainer.Directory;
  if (!Array.isArray(dirs)) return [];
  return dirs.map((d) => ({
    key: d.key,
    size: typeof d.size === "number" ? d.size : parseInt(String(d.size ?? ""), 10) || 0,
  }));
}
