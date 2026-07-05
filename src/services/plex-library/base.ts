/**
 * Shared fetch helper and library section listing.
 */

import { serverFetch } from "../plex-api";
import { cacheGet, cacheSet } from "../api-cache";
import { logger } from "../logger";
import type {
  LibrarySection,
  PlexMediaContainer,
  PlexMediaItem,
  PlexHub,
} from "../../types/library";
import { validateResponse, librarySectionsResponseSchema } from "../validation";
import { metadataContainerSchema, safeParsePlex } from "../plex-schemas";

/**
 * JSON fetch helper — shared by all plex-library modules.
 *
 * `signal` is optional and backward-compatible: pass an AbortController's
 * signal from a fetching effect so a stale request is cancelled on cleanup
 * instead of running to completion and discarding its result.
 */
export async function fetchJson<T>(
  serverUri: string,
  serverToken: string,
  path: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await serverFetch(serverUri, serverToken, path, signal);
  if (!response.ok) {
    throw new Error(
      `Plex API error: ${response.status} ${response.statusText}`
    );
  }
  return response.json() as Promise<T>;
}

/**
 * Fetch a metadata container and return its validated `Metadata` array.
 *
 * Runs the raw JSON through {@link metadataContainerSchema} (permissive Zod) so
 * callers receive trusted, fully-typed `PlexMediaItem[]` without casting. On a
 * shape mismatch the failure is logged (tag "api") and an empty array is
 * returned — the UI degrades gracefully instead of crashing.
 */
export async function fetchMetadata(
  serverUri: string,
  serverToken: string,
  path: string,
  label: string,
  signal?: AbortSignal,
): Promise<PlexMediaItem[]> {
  const raw = await fetchJson<unknown>(serverUri, serverToken, path, signal);
  const data = safeParsePlex(metadataContainerSchema, raw, label, {
    MediaContainer: { size: 0 },
  });
  return data.MediaContainer.Metadata ?? [];
}

/**
 * Fetch a hub container (e.g. /hubs/search, /hubs/metadata) and return its
 * validated `Hub` array. Validated via {@link metadataContainerSchema} (which
 * includes `Hub`), logging and returning `[]` on mismatch.
 */
export async function fetchHubs(
  serverUri: string,
  serverToken: string,
  path: string,
  label: string,
  signal?: AbortSignal,
): Promise<PlexHub[]> {
  const raw = await fetchJson<unknown>(serverUri, serverToken, path, signal);
  const data = safeParsePlex(metadataContainerSchema, raw, label, {
    MediaContainer: { size: 0 },
  });
  return data.MediaContainer.Hub ?? [];
}

// ── Library Sections ──

/**
 * Short-TTL cache for the section list — call sites like getMediaByActor's
 * per-actor fan-out and collection lookups call this service function
 * directly (bypassing useLibrary's hook-level cache) and all want the same
 * nearly-static data. A 60s TTL keeps it cheap without going stale for a
 * whole session (sections rarely change).
 *
 * Deliberately namespaced apart from useLibrary's own `library-sections:`
 * cache key (30 min, persisted) — that hook always revalidates in the
 * background on its own schedule, and this cache must not shorten or
 * collide with that contract.
 */
const SECTIONS_CACHE_TTL = 60 * 1000;

export async function getLibrarySections(
  serverUri: string,
  serverToken: string,
  signal?: AbortSignal,
): Promise<LibrarySection[]> {
  const cacheKey = `svc-sections:${serverUri}`;
  const cached = cacheGet<LibrarySection[]>(cacheKey);
  if (cached) {
    logger.debug("api", "getLibrarySections: cache hit", { count: cached.length });
    // Return a deep copy, NOT the cached reference. Before this cache existed,
    // every call produced a fresh JSON parse, and useLibrary's SWR
    // revalidation relies on that: setSections(sameReference) is
    // Object.is-equal, skips the re-render, and downstream effects keyed on
    // section identity (e.g. LibraryView's document.title effect, which must
    // re-fire AFTER the route announcer's fallback title) never re-run.
    return structuredClone(cached);
  }

  const data = await fetchJson<PlexMediaContainer<never>>(
    serverUri,
    serverToken,
    "/library/sections",
    signal,
  );
  validateResponse(librarySectionsResponseSchema, data, "getLibrarySections");
  const sections = data.MediaContainer.Directory ?? [];
  cacheSet(cacheKey, sections, SECTIONS_CACHE_TTL);
  return sections;
}
