/**
 * New content tracking — per-section last-seen timestamps and app launch time.
 */

import { STORAGE_KEYS, localStore } from "./backends";

// ── Per-section last-seen timestamps ──

export async function getLastSeenTimestamps(): Promise<Record<string, number>> {
  const timestamps = await localStore.get<Record<string, number>>(
    STORAGE_KEYS.SECTION_LAST_SEEN
  );
  return timestamps ?? {};
}

export async function saveLastSeenTimestamps(
  timestamps: Record<string, number>
): Promise<void> {
  await localStore.set(STORAGE_KEYS.SECTION_LAST_SEEN, timestamps);
}

export async function markSectionSeen(
  sectionKey: string
): Promise<Record<string, number>> {
  const timestamps = await getLastSeenTimestamps();
  const updated = { ...timestamps, [sectionKey]: Math.floor(Date.now() / 1000) };
  await saveLastSeenTimestamps(updated);
  return updated;
}

export async function markAllSectionsSeen(
  sectionKeys: string[]
): Promise<Record<string, number>> {
  const timestamps = await getLastSeenTimestamps();
  const now = Math.floor(Date.now() / 1000);
  const updated = { ...timestamps };
  for (const key of sectionKeys) {
    updated[key] = now;
  }
  await saveLastSeenTimestamps(updated);
  return updated;
}

// ── App last launch ──

export async function getAppLastLaunch(): Promise<number> {
  const ts = await localStore.get<number>(STORAGE_KEYS.APP_LAST_LAUNCH);
  return ts ?? 0;
}

export async function saveAppLastLaunch(timestamp: number): Promise<void> {
  await localStore.set(STORAGE_KEYS.APP_LAST_LAUNCH, timestamp);
}
