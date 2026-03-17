/**
 * Related items, extras, actor media, and search.
 */

import { fetchJson } from "./base";
import { getLibrarySections } from "./base";
import type {
  PlexMediaContainer,
  PlexMediaItem,
  PlexHub,
} from "../../types/library";

// ── Related Items ──

export async function getRelatedItems(
  serverUri: string,
  serverToken: string,
  ratingKey: string
): Promise<PlexMediaItem[]> {
  // Try the /library/metadata/{id}/similar endpoint first (most reliable)
  try {
    const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
      serverUri,
      serverToken,
      `/library/metadata/${ratingKey}/similar`
    );
    const items = data.MediaContainer.Metadata ?? [];
    if (items.length > 0) return items;
  } catch {
    // Fall through
  }
  // Try /related endpoint
  try {
    const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
      serverUri,
      serverToken,
      `/library/metadata/${ratingKey}/related`
    );
    const items = data.MediaContainer.Metadata ?? [];
    if (items.length > 0) return items;
  } catch {
    // Fall through to hubs endpoint
  }
  // Fallback: use /hubs/metadata endpoint which returns recommendation hubs
  try {
    const data = await fetchJson<{
      MediaContainer: {
        Hub?: Array<{
          type: string;
          hubIdentifier: string;
          title: string;
          Metadata?: PlexMediaItem[];
        }>;
      };
    }>(serverUri, serverToken, `/hubs/metadata/${ratingKey}`);
    const hubs = data.MediaContainer.Hub ?? [];
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
  ratingKey: string
): Promise<PlexMediaItem[]> {
  const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
    serverUri,
    serverToken,
    `/library/metadata/${ratingKey}/extras`
  );
  return data.MediaContainer.Metadata ?? [];
}

/**
 * Find all media featuring a specific actor across all library sections.
 * Uses the Plex library filter endpoint which is more thorough than hub search.
 */
export async function getMediaByActor(
  serverUri: string,
  serverToken: string,
  actorName: string
): Promise<PlexMediaItem[]> {
  // First get all library sections
  const sections = await getLibrarySections(serverUri, serverToken);
  const movieAndShowSections = sections.filter(
    (s) => s.type === "movie" || s.type === "show"
  );

  // Query each section in parallel with actor filter
  const results = await Promise.allSettled(
    movieAndShowSections.map(async (section) => {
      const params = new URLSearchParams({
        "X-Plex-Container-Size": "200",
        sort: "titleSort:asc",
        actor: actorName,
      });
      // For show sections, request type=2 (shows) not type=4 (episodes)
      if (section.type === "show") {
        params.set("type", "2");
      }
      const path = `/library/sections/${section.key}/all?${params.toString()}`;
      const data = await fetchJson<PlexMediaContainer<PlexMediaItem>>(
        serverUri,
        serverToken,
        path
      );
      return data.MediaContainer.Metadata ?? [];
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
  const data = await fetchJson<PlexMediaContainer<never>>(
    serverUri,
    serverToken,
    `/hubs/search?${params.toString()}`
  );
  return data.MediaContainer.Hub ?? [];
}
