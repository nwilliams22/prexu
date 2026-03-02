/**
 * Generic in-memory TTL cache for API responses.
 *
 * Used across hooks to avoid redundant network calls when navigating
 * between pages. Each entry has an independent TTL. Cache lives in
 * module scope (survives component unmounts but not app restarts).
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/** Get cached data, or null if missing/expired. */
export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttlMs) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

/** Store data with a TTL (milliseconds). */
export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, timestamp: Date.now(), ttlMs });
}

/** Remove a single cache entry. */
export function cacheInvalidate(key: string): void {
  store.delete(key);
}

/** Remove all entries whose key starts with the given prefix. */
export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Clear all cached data. */
export function cacheClear(): void {
  store.clear();
}
