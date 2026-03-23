/**
 * Pending watch sync storage — tracks items watched offline
 * that need to be synced to the Plex server when back online.
 */

import { STORAGE_KEYS, localStore } from "./backends";

export interface PendingWatchSync {
  ratingKey: string;
  /** Epoch ms when the item was watched offline */
  watchedAt: number;
}

export async function getPendingWatchSync(): Promise<PendingWatchSync[]> {
  return (
    (await localStore.get<PendingWatchSync[]>(STORAGE_KEYS.PENDING_WATCH_SYNC)) ?? []
  );
}

export async function savePendingWatchSync(
  items: PendingWatchSync[],
): Promise<void> {
  await localStore.set(STORAGE_KEYS.PENDING_WATCH_SYNC, items);
}

export async function addPendingWatchSync(
  ratingKey: string,
): Promise<void> {
  const pending = await getPendingWatchSync();
  // Don't add duplicates
  if (pending.some((p) => p.ratingKey === ratingKey)) return;
  pending.push({ ratingKey, watchedAt: Date.now() });
  await savePendingWatchSync(pending);
}

export async function removePendingWatchSync(
  ratingKey: string,
): Promise<void> {
  const pending = await getPendingWatchSync();
  await savePendingWatchSync(pending.filter((p) => p.ratingKey !== ratingKey));
}
