/**
 * Shared fetch helper and library section listing.
 */

import { serverFetch } from "../plex-api";
import type { LibrarySection, PlexMediaContainer } from "../../types/library";
import { validateResponse, librarySectionsResponseSchema } from "../validation";

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
