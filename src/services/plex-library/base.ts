/**
 * Shared fetch helper and library section listing.
 */

import { serverFetch } from "../plex-api";
import type {
  LibrarySection,
  PlexMediaContainer,
  PlexMediaItem,
  PlexHub,
} from "../../types/library";
import { validateResponse, librarySectionsResponseSchema } from "../validation";
import { metadataContainerSchema, safeParsePlex } from "../plex-schemas";

/** JSON fetch helper — shared by all plex-library modules */
export async function fetchJson<T>(
  serverUri: string,
  serverToken: string,
  path: string
): Promise<T> {
  const response = await serverFetch(serverUri, serverToken, path);
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
): Promise<PlexMediaItem[]> {
  const raw = await fetchJson<unknown>(serverUri, serverToken, path);
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
): Promise<PlexHub[]> {
  const raw = await fetchJson<unknown>(serverUri, serverToken, path);
  const data = safeParsePlex(metadataContainerSchema, raw, label, {
    MediaContainer: { size: 0 },
  });
  return data.MediaContainer.Hub ?? [];
}

// ── Library Sections ──

export async function getLibrarySections(
  serverUri: string,
  serverToken: string
): Promise<LibrarySection[]> {
  const data = await fetchJson<PlexMediaContainer<never>>(
    serverUri,
    serverToken,
    "/library/sections"
  );
  validateResponse(librarySectionsResponseSchema, data, "getLibrarySections");
  return data.MediaContainer.Directory ?? [];
}
