/**
 * Storage backends: secure store (tauri-plugin-store) and localStorage.
 *
 * Sensitive data (auth tokens) uses tauri-plugin-store when available,
 * falling back to localStorage in browser/dev environments.
 * Non-sensitive data always uses localStorage.
 */

// ── Secure store (tauri-plugin-store) ──

type LazyStoreType = import("@tauri-apps/plugin-store").LazyStore;
let secureStore: LazyStoreType | null = null;
let tauriUnavailable = false;

/** Check if we're running inside a Tauri webview */
function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getSecureStore(): Promise<LazyStoreType | null> {
  if (secureStore) return secureStore;
  if (tauriUnavailable) return null;

  if (!isTauriRuntime()) {
    tauriUnavailable = true;
    return null;
  }

  try {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    secureStore = new LazyStore("secure-store.json");
    return secureStore;
  } catch {
    tauriUnavailable = true;
    return null;
  }
}

// ── Storage backend implementations ──

export const secureStorage = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const store = await getSecureStore();
      if (store) {
        const value = await store.get<T>(key);
        return value ?? null;
      }
      // Fallback to localStorage when Tauri is not available
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    const store = await getSecureStore();
    if (store) {
      await store.set(key, value);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  },

  async remove(key: string): Promise<void> {
    const store = await getSecureStore();
    if (store) {
      await store.delete(key);
    } else {
      localStorage.removeItem(key);
    }
  },
};

export const localStore = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value));
  },

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  },
};

// ── Storage keys ──

export const STORAGE_KEYS = {
  AUTH: "auth_data",
  SERVER: "server_data",
  CLIENT_ID: "client_identifier",
  RELAY_URL: "prexu_relay_url",
  PREFERENCES: "prexu_preferences",
  ADMIN_AUTH: "admin_auth_data",
  ACTIVE_USER: "active_user",
  CONTENT_REQUESTS: "prexu_content_requests",
  REQUESTS_LAST_READ: "prexu_requests_last_read",
  DISMISSED_RECOMMENDATIONS: "prexu_dismissed_recommendations",
  RECENT_SEARCHES: "prexu_recent_searches",
  SECTION_LAST_SEEN: "prexu_section_last_seen",
  APP_LAST_LAUNCH: "prexu_app_last_launch",
  PARENTAL_CONTROLS: "prexu_parental",
  DOWNLOADS: "prexu_downloads",
  PENDING_WATCH_SYNC: "prexu_pending_watch_sync",
  INVITE_NOTIFICATION_VOLUME: "prexu_invite_notification_volume",
  INVITE_NOTIFICATION_SOUND: "prexu_invite_notification_sound",
} as const;

/** Keys that hold sensitive data and must use the secure store */
export const SECURE_KEYS = new Set<string>([
  STORAGE_KEYS.AUTH,
  STORAGE_KEYS.ADMIN_AUTH,
  STORAGE_KEYS.ACTIVE_USER,
]);

/** Route to the correct backend based on key sensitivity */
export function storageFor(key: string) {
  return SECURE_KEYS.has(key) ? secureStorage : localStore;
}

// ── Migration: move sensitive data from localStorage to secure store ──

const MIGRATION_FLAG = "prexu_secure_migration_done";

export async function migrateToSecureStorage(): Promise<void> {
  // Skip if already migrated or secure store unavailable
  if (localStorage.getItem(MIGRATION_FLAG)) return;
  const store = await getSecureStore();
  if (!store) return;

  for (const key of SECURE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const value = JSON.parse(raw);
        await store.set(key, value);
        localStorage.removeItem(key);
      }
    } catch {
      // Skip keys that fail to parse
    }
  }

  localStorage.setItem(MIGRATION_FLAG, "1");
}
