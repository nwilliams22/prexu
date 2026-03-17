/**
 * Watch state management: mark as watched/unwatched.
 */

import { serverFetch } from "../plex-api";

export async function markAsWatched(
  serverUri: string,
  serverToken: string,
  ratingKey: string
): Promise<void> {
  const response = await serverFetch(
    serverUri,
    serverToken,
    `/:/scrobble?identifier=com.plexapp.plugins.library&key=${ratingKey}`
  );
  if (!response.ok) {
    throw new Error(`Failed to mark as watched: ${response.status}`);
  }
}

export async function markAsUnwatched(
  serverUri: string,
  serverToken: string,
  ratingKey: string
): Promise<void> {
  const response = await serverFetch(
    serverUri,
    serverToken,
    `/:/unscrobble?identifier=com.plexapp.plugins.library&key=${ratingKey}`
  );
  if (!response.ok) {
    throw new Error(`Failed to mark as unwatched: ${response.status}`);
  }
}
