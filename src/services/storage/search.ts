/**
 * Recent searches storage.
 */

import { STORAGE_KEYS, localStore } from "./backends";

const MAX_RECENT_SEARCHES = 10;

export async function getRecentSearches(): Promise<string[]> {
  const searches = await localStore.get<string[]>(STORAGE_KEYS.RECENT_SEARCHES);
  return searches ?? [];
}

export async function saveRecentSearches(searches: string[]): Promise<void> {
  await localStore.set(STORAGE_KEYS.RECENT_SEARCHES, searches);
}

export async function addRecentSearch(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return getRecentSearches();

  const searches = await getRecentSearches();
  const filtered = searches.filter(
    (s) => s.toLowerCase() !== trimmed.toLowerCase()
  );
  const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);
  await saveRecentSearches(updated);
  return updated;
}

export async function removeRecentSearch(query: string): Promise<string[]> {
  const searches = await getRecentSearches();
  const updated = searches.filter(
    (s) => s.toLowerCase() !== query.toLowerCase()
  );
  await saveRecentSearches(updated);
  return updated;
}
