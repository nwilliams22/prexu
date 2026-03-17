/**
 * Library administration: scan, refresh metadata, empty trash.
 */

import { serverFetch, getServerHeaders } from "../plex-api";

export async function scanLibrary(
  serverUri: string,
  serverToken: string,
  sectionId: string
): Promise<void> {
  const response = await serverFetch(
    serverUri,
    serverToken,
    `/library/sections/${sectionId}/refresh`
  );
  if (!response.ok) {
    throw new Error(`Failed to scan library: ${response.status}`);
  }
}

export async function refreshLibraryMetadata(
  serverUri: string,
  serverToken: string,
  sectionId: string
): Promise<void> {
  const headers = await getServerHeaders(serverToken);
  const response = await fetch(
    `${serverUri}/library/sections/${sectionId}/refresh?force=1`,
    { method: "PUT", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to refresh metadata: ${response.status}`);
  }
}

export async function emptyLibraryTrash(
  serverUri: string,
  serverToken: string,
  sectionId: string
): Promise<void> {
  const headers = await getServerHeaders(serverToken);
  const response = await fetch(
    `${serverUri}/library/sections/${sectionId}/emptyTrash`,
    { method: "PUT", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to empty trash: ${response.status}`);
  }
}
