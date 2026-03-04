/**
 * Generic TTL cache for API responses with optional localStorage persistence.
 *
 * In-memory layer for fast access during the session. Entries marked as
 * persistent are also written to localStorage so they survive app restarts
 * (e.g. dashboard data for instant startup).
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

const STORAGE_PREFIX = "prexu_cache:";

const store = new Map<string, CacheEntry<unknown>>();

/** Try to restore a persistent entry from localStorage into memory. */
function restoreFromStorage<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.timestamp > entry.ttlMs) {
      localStorage.removeItem(STORAGE_PREFIX + key);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

/** Get cached data, or null if missing/expired. Checks localStorage fallback. */
export function cacheGet<T>(key: string): T | null {
  // Check in-memory first
  const memEntry = store.get(key);
  if (memEntry) {
    if (Date.now() - memEntry.timestamp > memEntry.ttlMs) {
      store.delete(key);
    } else {
      return memEntry.data as T;
    }
  }

  // Fallback: check localStorage for persistent entries
  const diskEntry = restoreFromStorage<T>(key);
  if (diskEntry) {
    store.set(key, diskEntry); // promote to memory
    return diskEntry.data;
  }

  return null;
}

/**
 * Store data with a TTL (milliseconds).
 * Pass `persist: true` to also write to localStorage for cross-restart caching.
 */
export function cacheSet<T>(
  key: string,
  data: T,
  ttlMs: number,
  persist = false,
): void {
  const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttlMs };
  store.set(key, entry);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Storage full or unavailable — in-memory cache still works
    }
  }
}

/** Remove a single cache entry (memory + localStorage). */
export function cacheInvalidate(key: string): void {
  store.delete(key);
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // ignore
  }
}

/** Remove all entries whose key starts with the given prefix. */
export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const storageKey = localStorage.key(i);
      if (storageKey?.startsWith(STORAGE_PREFIX + prefix)) {
        localStorage.removeItem(storageKey);
      }
    }
  } catch {
    // ignore
  }
}

/** Clear all cached data (memory + localStorage). */
export function cacheClear(): void {
  store.clear();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
}
