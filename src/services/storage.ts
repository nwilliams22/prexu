/**
 * Storage abstraction layer.
 *
 * Sensitive data (auth tokens, API keys) is stored via tauri-plugin-store,
 * which persists to the app data directory and is not accessible from browser
 * DevTools or via XSS on the webview.
 *
 * Non-sensitive data (preferences, UI state, content requests) remains in
 * localStorage for simplicity and performance.
 */

import type { AuthData, ServerData } from "../types/plex";
import type { Preferences } from "../types/preferences";
import type { ActiveUser } from "../types/home-user";
import type { ContentRequest } from "../types/content-request";

const STORAGE_KEYS = {
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
} as const;

/** Keys that hold sensitive data and must use the secure store */
const SECURE_KEYS = new Set<string>([
  STORAGE_KEYS.AUTH,
  STORAGE_KEYS.ADMIN_AUTH,
  STORAGE_KEYS.ACTIVE_USER,
]);

const DEFAULT_RELAY_PORT = 9847;

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

// ── Storage backends ──

const secureStorage = {
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

const localStore = {
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

/** Route to the correct backend based on key sensitivity */
function storageFor(key: string) {
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

// ── Public API (unchanged signatures) ──

/** Get or create a persistent client identifier for this device */
export async function getClientIdentifier(): Promise<string> {
  let clientId = await localStore.get<string>(STORAGE_KEYS.CLIENT_ID);
  if (!clientId) {
    clientId = crypto.randomUUID();
    await localStore.set(STORAGE_KEYS.CLIENT_ID, clientId);
  }
  return clientId;
}

/** Save auth data after successful login */
export async function saveAuth(data: AuthData): Promise<void> {
  await storageFor(STORAGE_KEYS.AUTH).set(STORAGE_KEYS.AUTH, data);
}

/** Get stored auth data (returns null if not logged in) */
export async function getAuth(): Promise<AuthData | null> {
  return storageFor(STORAGE_KEYS.AUTH).get<AuthData>(STORAGE_KEYS.AUTH);
}

/** Clear auth data (logout) */
export async function clearAuth(): Promise<void> {
  await storageFor(STORAGE_KEYS.AUTH).remove(STORAGE_KEYS.AUTH);
  await storageFor(STORAGE_KEYS.SERVER).remove(STORAGE_KEYS.SERVER);
  await storageFor(STORAGE_KEYS.ADMIN_AUTH).remove(STORAGE_KEYS.ADMIN_AUTH);
  await storageFor(STORAGE_KEYS.ACTIVE_USER).remove(STORAGE_KEYS.ACTIVE_USER);
}

/** Save selected server */
export async function saveServer(data: ServerData): Promise<void> {
  await storageFor(STORAGE_KEYS.SERVER).set(STORAGE_KEYS.SERVER, data);
}

/** Get stored selected server */
export async function getServer(): Promise<ServerData | null> {
  return storageFor(STORAGE_KEYS.SERVER).get<ServerData>(STORAGE_KEYS.SERVER);
}

/** Clear selected server (to re-pick) */
export async function clearServer(): Promise<void> {
  await storageFor(STORAGE_KEYS.SERVER).remove(STORAGE_KEYS.SERVER);
}

// ── Relay Server URL ──

/**
 * Derive the relay URL from a Plex server URI.
 * Since the relay runs on the same machine as Plex, we extract the hostname
 * from the Plex server address and use the default relay port.
 * This means friends don't need to configure anything — it "just works".
 */
export function deriveRelayUrl(serverUri: string): string {
  try {
    const url = new URL(serverUri);
    return `ws://${url.hostname}:${DEFAULT_RELAY_PORT}/ws`;
  } catch {
    return `ws://localhost:${DEFAULT_RELAY_PORT}/ws`;
  }
}

/**
 * Get the relay URL to use.
 * Priority: manual override > auto-derived from server URI > localhost fallback.
 */
export async function getRelayUrl(serverUri?: string | null): Promise<string> {
  // Check for manual override first
  const manual = await localStore.get<string>(STORAGE_KEYS.RELAY_URL);
  if (manual) return manual;

  // Auto-derive from Plex server URI
  if (serverUri) return deriveRelayUrl(serverUri);

  // Fallback
  return `ws://localhost:${DEFAULT_RELAY_PORT}/ws`;
}

/** Save a manual relay server URL override */
export async function saveRelayUrl(url: string): Promise<void> {
  await localStore.set(STORAGE_KEYS.RELAY_URL, url);
}

/** Clear the manual relay URL override (revert to auto-discovery) */
export async function clearRelayUrl(): Promise<void> {
  await localStore.remove(STORAGE_KEYS.RELAY_URL);
}

/** Check if user has set a manual relay URL override */
export async function hasManualRelayUrl(): Promise<boolean> {
  const url = await localStore.get<string>(STORAGE_KEYS.RELAY_URL);
  return url !== null;
}

/**
 * Get the relay server's HTTP base URL (for REST endpoints like TMDb proxy).
 * Converts ws://host:port/ws → http://host:port
 * Converts wss://host:port/ws → https://host:port
 */
export async function getRelayHttpUrl(serverUri?: string | null): Promise<string> {
  const wsUrl = await getRelayUrl(serverUri);
  return wsUrl
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:")
    .replace(/\/ws$/, "");
}

// ── Admin Token (preserved for switching back from managed user) ──

export async function saveAdminAuth(data: AuthData): Promise<void> {
  await storageFor(STORAGE_KEYS.ADMIN_AUTH).set(STORAGE_KEYS.ADMIN_AUTH, data);
}

export async function getAdminAuth(): Promise<AuthData | null> {
  return storageFor(STORAGE_KEYS.ADMIN_AUTH).get<AuthData>(STORAGE_KEYS.ADMIN_AUTH);
}

export async function clearAdminAuth(): Promise<void> {
  await storageFor(STORAGE_KEYS.ADMIN_AUTH).remove(STORAGE_KEYS.ADMIN_AUTH);
}

// ── Active User ──

export async function saveActiveUser(user: ActiveUser): Promise<void> {
  await storageFor(STORAGE_KEYS.ACTIVE_USER).set(STORAGE_KEYS.ACTIVE_USER, user);
}

export async function getActiveUser(): Promise<ActiveUser | null> {
  return storageFor(STORAGE_KEYS.ACTIVE_USER).get<ActiveUser>(STORAGE_KEYS.ACTIVE_USER);
}

export async function clearActiveUser(): Promise<void> {
  await storageFor(STORAGE_KEYS.ACTIVE_USER).remove(STORAGE_KEYS.ACTIVE_USER);
}

// ── Preferences ──

export function getDefaultPreferences(): Preferences {
  return {
    playback: {
      quality: "1080p",
      preferredAudioLanguage: "",
      preferredSubtitleLanguage: "",
      defaultSubtitles: "auto",
      subtitleSize: 100,
      audioBoost: 100,
      directPlayPreference: "auto",
      volumeBoost: 1.0,
      normalizationPreset: "off",
      audioOffsetMs: 0,
    },
    appearance: {
      posterSize: "medium",
      sidebarCollapsed: false,
      dashboardSections: {
        continueWatching: true,
        recentMovies: true,
        recentShows: true,
      },
      skipSingleSeason: true,
      minCollectionSize: 2,
    },
  };
}

function mergeWithDefaults(saved: Preferences): Preferences {
  const defaults = getDefaultPreferences();
  return {
    playback: { ...defaults.playback, ...saved.playback },
    appearance: {
      ...defaults.appearance,
      ...saved.appearance,
      dashboardSections: {
        ...defaults.appearance.dashboardSections,
        ...saved.appearance?.dashboardSections,
      },
    },
  };
}

export async function getPreferences(): Promise<Preferences> {
  const saved = await localStore.get<Preferences>(STORAGE_KEYS.PREFERENCES);
  if (!saved) return getDefaultPreferences();
  return mergeWithDefaults(saved);
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await localStore.set(STORAGE_KEYS.PREFERENCES, prefs);
}

// ── Per-User Preferences ──

function userPrefsKey(userId: number): string {
  return `prexu_preferences_${userId}`;
}

export async function getUserPreferences(userId: number): Promise<Preferences> {
  const saved = await localStore.get<Preferences>(userPrefsKey(userId));
  if (!saved) {
    // Fall back to global prefs (migration path for existing users)
    const global = await localStore.get<Preferences>(STORAGE_KEYS.PREFERENCES);
    if (global) return mergeWithDefaults(global);
    return getDefaultPreferences();
  }
  return mergeWithDefaults(saved);
}

export async function saveUserPreferences(
  userId: number,
  prefs: Preferences
): Promise<void> {
  await localStore.set(userPrefsKey(userId), prefs);
}

// ── Content Requests ──

export async function getContentRequests(): Promise<ContentRequest[]> {
  const requests = await localStore.get<ContentRequest[]>(STORAGE_KEYS.CONTENT_REQUESTS);
  return requests ?? [];
}

export async function saveContentRequests(requests: ContentRequest[]): Promise<void> {
  await localStore.set(STORAGE_KEYS.CONTENT_REQUESTS, requests);
}

export async function getRequestsLastRead(): Promise<number> {
  const ts = await localStore.get<number>(STORAGE_KEYS.REQUESTS_LAST_READ);
  return ts ?? 0;
}

export async function saveRequestsLastRead(timestamp: number): Promise<void> {
  await localStore.set(STORAGE_KEYS.REQUESTS_LAST_READ, timestamp);
}

/** Get the set of dismissed recommendation ratingKeys */
export async function getDismissedRecommendations(): Promise<string[]> {
  const keys = await localStore.get<string[]>(STORAGE_KEYS.DISMISSED_RECOMMENDATIONS);
  return keys ?? [];
}

/** Save the set of dismissed recommendation ratingKeys */
export async function saveDismissedRecommendations(keys: string[]): Promise<void> {
  await localStore.set(STORAGE_KEYS.DISMISSED_RECOMMENDATIONS, keys);
}
