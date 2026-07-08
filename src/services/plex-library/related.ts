/**
 * Related items, extras, actor media, and search.
 */

import { fetchMetadata, fetchHubs } from "./base";
import { getLibrarySections } from "./base";
import { logger } from "../logger";
import { cacheGet, cacheSet } from "../api-cache";
import type { PlexMediaItem, PlexHub } from "../../types/library";

// ── Related Items ──

/**
 * Fetch items related to a given media item.
 *
 * Plex only computes /similar for movies and shows — episodes return 404.
 * Pass `itemType` so the service can skip the /similar round-trip entirely.
 */
export async function getRelatedItems(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
  itemType?: string,
  signal?: AbortSignal,
): Promise<PlexMediaItem[]> {
  if (itemType === "episode") {
    logger.debug("api", "getRelatedItems: skipping /similar for episode", { ratingKey });
    return [];
  }

  // Try the /library/metadata/{id}/similar endpoint first (most reliable)
  try {
    const items = await fetchMetadata(
      serverUri,
      serverToken,
      `/library/metadata/${ratingKey}/similar`,
      "getRelatedItems:similar",
      signal,
    );
    if (items.length > 0) return items;
  } catch {
    // Fall through
  }
  // Try /related endpoint
  try {
    const items = await fetchMetadata(
      serverUri,
      serverToken,
      `/library/metadata/${ratingKey}/related`,
      "getRelatedItems:related",
      signal,
    );
    if (items.length > 0) return items;
  } catch {
    // Fall through to hubs endpoint
  }
  // Fallback: use /hubs/metadata endpoint which returns recommendation hubs
  try {
    const hubs = await fetchHubs(
      serverUri,
      serverToken,
      `/hubs/metadata/${ratingKey}`,
      "getRelatedItems:hubs",
      signal,
    );
    // Collect items from all relevant hubs (similar, related, recommendations)
    const items: PlexMediaItem[] = [];
    for (const hub of hubs) {
      if (hub.Metadata && hub.Metadata.length > 0) {
        // Skip hubs that are the item's own extras or cast
        const id = hub.hubIdentifier?.toLowerCase() ?? "";
        const title = hub.title?.toLowerCase() ?? "";
        if (
          id.includes("extra") ||
          id.includes("cast") ||
          id.includes("review") ||
          title.includes("extra") ||
          title.includes("cast") ||
          title.includes("review")
        ) {
          continue;
        }
        items.push(...hub.Metadata);
      }
    }
    // Deduplicate by ratingKey
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.ratingKey)) return false;
      seen.add(item.ratingKey);
      return true;
    });
  } catch {
    return [];
  }
}

// ── Extras (trailers, behind-the-scenes, etc.) ──

export async function getExtras(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
  signal?: AbortSignal,
): Promise<PlexMediaItem[]> {
  return fetchMetadata(
    serverUri,
    serverToken,
    `/library/metadata/${ratingKey}/extras`,
    "getExtras",
    signal,
  );
}

/**
 * Shelf size for "More with [Actor]" rows — this is a horizontal-scroll shelf
 * on the detail page, not a full library listing, so there's no reason to
 * pull 200 full-metadata items per section (prexu-0szx.4).
 */
const ACTOR_SHELF_SIZE = 20;

/** Session-TTL cache for actor media lookups — an actor's filmography barely
 *  changes within a session, and this fans out to every movie+show section
 *  for BOTH lead actors on every detail view (prexu-0szx.4). */
const ACTOR_MEDIA_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/** True when a rejection reason is a fetch/abort cancellation. */
function isAbortError(reason: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      reason instanceof DOMException &&
      reason.name === "AbortError") ||
    (reason instanceof Error && reason.name === "AbortError")
  );
}

/**
 * Find all media featuring a specific actor across all library sections.
 * Uses the Plex library filter endpoint which is more thorough than hub search.
 *
 * Cached per server+actor (session TTL) and capped to a shelf-sized page —
 * this is rendered as a "More with [Actor]" horizontal row, not a full
 * library listing.
 */
export async function getMediaByActor(
  serverUri: string,
  serverToken: string,
  actorName: string,
  signal?: AbortSignal,
): Promise<PlexMediaItem[]> {
  const cacheKey = `actor-media:${serverUri}:${actorName}`;
  const cached = cacheGet<PlexMediaItem[]>(cacheKey);
  if (cached) {
    logger.debug("api", "getMediaByActor: cache hit", { actorName, count: cached.length });
    return cached;
  }

  // First get all library sections (itself cached — see base.ts)
  const sections = await getLibrarySections(serverUri, serverToken, signal);
  const movieAndShowSections = sections.filter(
    (s) => s.type === "movie" || s.type === "show"
  );

  // Query each section in parallel with actor filter
  const results = await Promise.allSettled(
    movieAndShowSections.map(async (section) => {
      const params = new URLSearchParams({
        "X-Plex-Container-Size": String(ACTOR_SHELF_SIZE),
        sort: "titleSort:asc",
        actor: actorName,
      });
      // For show sections, request type=2 (shows) not type=4 (episodes)
      if (section.type === "show") {
        params.set("type", "2");
      }
      const path = `/library/sections/${section.key}/all?${params.toString()}`;
      return fetchMetadata(serverUri, serverToken, path, "getMediaByActor", signal);
    })
  );

  // Merge and deduplicate by ratingKey
  const seen = new Set<string>();
  const items: PlexMediaItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const item of r.value) {
        if (!seen.has(item.ratingKey)) {
          seen.add(item.ratingKey);
          items.push(item);
        }
      }
    }
  }
  // Don't persist a truncated result produced by a cancelled request
  // (prexu-9f4s.2): if the caller aborted mid-flight, the section queries were
  // interrupted and `items` is empty/partial. Caching it here would pin that
  // wrong result under this actor for the full 10-minute TTL, so the next
  // (non-aborted) detail view keeps showing an empty "More with [Actor]" row.
  const aborted =
    signal?.aborted === true ||
    results.some((r) => r.status === "rejected" && isAbortError(r.reason));
  if (aborted) {
    logger.debug("api", "getMediaByActor: request aborted, skipping cache write", {
      actorName,
      count: items.length,
    });
    return items;
  }

  cacheSet(cacheKey, items, ACTOR_MEDIA_CACHE_TTL);
  return items;
}

// ── Search ──

export async function searchLibrary(
  serverUri: string,
  serverToken: string,
  query: string,
  limit: number = 10
): Promise<PlexHub[]> {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return fetchHubs(
    serverUri,
    serverToken,
    `/hubs/search?${params.toString()}`,
    "searchLibrary",
  );
}
