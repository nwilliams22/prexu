/**
 * Storage abstraction layer.
 *
 * On desktop (Tauri), this uses tauri-plugin-store for secure persistent storage.
 * This abstraction exists so we can swap in a different backend for smart TV
 * platforms later (e.g., localStorage, AsyncStorage, etc.) without changing
 * any consuming code.
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
  TMDB_API_KEY: "prexu_tmdb_api_key",
  CONTENT_REQUESTS: "prexu_content_requests",
  REQUESTS_LAST_READ: "prexu_requests_last_read",
  DISMISSED_RECOMMENDATIONS: "prexu_dismissed_recommendations",
} as const;

const DEFAULT_RELAY_PORT = 9847;

// For now, use localStorage as the storage backend.
// When tauri-plugin-store is integrated with the Rust backend,
// we'll swap this to use Tauri IPC commands for secure storage.
const storage = {
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

/** Get or create a persistent client identifier for this device */
export async function getClientIdentifier(): Promise<string> {
  let clientId = await storage.get<string>(STORAGE_KEYS.CLIENT_ID);
  if (!clientId) {
    clientId = crypto.randomUUID();
    await storage.set(STORAGE_KEYS.CLIENT_ID, clientId);
  }
  return clientId;
}

/** Save auth data after successful login */
export async function saveAuth(data: AuthData): Promise<void> {
  await storage.set(STORAGE_KEYS.AUTH, data);
}

/** Get stored auth data (returns null if not logged in) */
export async function getAuth(): Promise<AuthData | null> {
  return storage.get<AuthData>(STORAGE_KEYS.AUTH);
}

/** Clear auth data (logout) */
export async function clearAuth(): Promise<void> {
  await storage.remove(STORAGE_KEYS.AUTH);
  await storage.remove(STORAGE_KEYS.SERVER);
  await storage.remove(STORAGE_KEYS.ADMIN_AUTH);
  await storage.remove(STORAGE_KEYS.ACTIVE_USER);
}

/** Save selected server */
export async function saveServer(data: ServerData): Promise<void> {
  await storage.set(STORAGE_KEYS.SERVER, data);
}

/** Get stored selected server */
export async function getServer(): Promise<ServerData | null> {
  return storage.get<ServerData>(STORAGE_KEYS.SERVER);
}

/** Clear selected server (to re-pick) */
export async function clearServer(): Promise<void> {
  await storage.remove(STORAGE_KEYS.SERVER);
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
  const manual = await storage.get<string>(STORAGE_KEYS.RELAY_URL);
  if (manual) return manual;

  // Auto-derive from Plex server URI
  if (serverUri) return deriveRelayUrl(serverUri);

  // Fallback
  return `ws://localhost:${DEFAULT_RELAY_PORT}/ws`;
}

/** Save a manual relay server URL override */
export async function saveRelayUrl(url: string): Promise<void> {
  await storage.set(STORAGE_KEYS.RELAY_URL, url);
}

/** Clear the manual relay URL override (revert to auto-discovery) */
export async function clearRelayUrl(): Promise<void> {
  await storage.remove(STORAGE_KEYS.RELAY_URL);
}

/** Check if user has set a manual relay URL override */
export async function hasManualRelayUrl(): Promise<boolean> {
  const url = await storage.get<string>(STORAGE_KEYS.RELAY_URL);
  return url !== null;
}

// ── Admin Token (preserved for switching back from managed user) ──

export async function saveAdminAuth(data: AuthData): Promise<void> {
  await storage.set(STORAGE_KEYS.ADMIN_AUTH, data);
}

export async function getAdminAuth(): Promise<AuthData | null> {
  return storage.get<AuthData>(STORAGE_KEYS.ADMIN_AUTH);
}

export async function clearAdminAuth(): Promise<void> {
  await storage.remove(STORAGE_KEYS.ADMIN_AUTH);
}

// ── Active User ──

export async function saveActiveUser(user: ActiveUser): Promise<void> {
  await storage.set(STORAGE_KEYS.ACTIVE_USER, user);
}

export async function getActiveUser(): Promise<ActiveUser | null> {
  return storage.get<ActiveUser>(STORAGE_KEYS.ACTIVE_USER);
}

export async function clearActiveUser(): Promise<void> {
  await storage.remove(STORAGE_KEYS.ACTIVE_USER);
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
  const saved = await storage.get<Preferences>(STORAGE_KEYS.PREFERENCES);
  if (!saved) return getDefaultPreferences();
  return mergeWithDefaults(saved);
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await storage.set(STORAGE_KEYS.PREFERENCES, prefs);
}

// ── Per-User Preferences ──

function userPrefsKey(userId: number): string {
  return `prexu_preferences_${userId}`;
}

export async function getUserPreferences(userId: number): Promise<Preferences> {
  const saved = await storage.get<Preferences>(userPrefsKey(userId));
  if (!saved) {
    // Fall back to global prefs (migration path for existing users)
    const global = await storage.get<Preferences>(STORAGE_KEYS.PREFERENCES);
    if (global) return mergeWithDefaults(global);
    return getDefaultPreferences();
  }
  return mergeWithDefaults(saved);
}

export async function saveUserPreferences(
  userId: number,
  prefs: Preferences
): Promise<void> {
  await storage.set(userPrefsKey(userId), prefs);
}

// ── TMDb API Key ──

export async function getTmdbApiKey(): Promise<string | null> {
  return storage.get<string>(STORAGE_KEYS.TMDB_API_KEY);
}

export async function saveTmdbApiKey(key: string): Promise<void> {
  await storage.set(STORAGE_KEYS.TMDB_API_KEY, key);
}

export async function clearTmdbApiKey(): Promise<void> {
  await storage.remove(STORAGE_KEYS.TMDB_API_KEY);
}

// ── Content Requests ──

export async function getContentRequests(): Promise<ContentRequest[]> {
  const requests = await storage.get<ContentRequest[]>(STORAGE_KEYS.CONTENT_REQUESTS);
  return requests ?? [];
}

export async function saveContentRequests(requests: ContentRequest[]): Promise<void> {
  await storage.set(STORAGE_KEYS.CONTENT_REQUESTS, requests);
}

export async function getRequestsLastRead(): Promise<number> {
  const ts = await storage.get<number>(STORAGE_KEYS.REQUESTS_LAST_READ);
  return ts ?? 0;
}

export async function saveRequestsLastRead(timestamp: number): Promise<void> {
  await storage.set(STORAGE_KEYS.REQUESTS_LAST_READ, timestamp);
}

/** Get the set of dismissed recommendation ratingKeys */
export async function getDismissedRecommendations(): Promise<string[]> {
  const keys = await storage.get<string[]>(STORAGE_KEYS.DISMISSED_RECOMMENDATIONS);
  return keys ?? [];
}

/** Save the set of dismissed recommendation ratingKeys */
export async function saveDismissedRecommendations(keys: string[]): Promise<void> {
  await storage.set(STORAGE_KEYS.DISMISSED_RECOMMENDATIONS, keys);
}
