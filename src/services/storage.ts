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

const STORAGE_KEYS = {
  AUTH: "auth_data",
  SERVER: "server_data",
  CLIENT_ID: "client_identifier",
  RELAY_URL: "prexu_relay_url",
  PREFERENCES: "prexu_preferences",
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
    },
    appearance: {
      posterSize: "medium",
      sidebarCollapsed: false,
      dashboardSections: {
        continueWatching: true,
        recentMovies: true,
        recentShows: true,
      },
    },
  };
}

export async function getPreferences(): Promise<Preferences> {
  const saved = await storage.get<Preferences>(STORAGE_KEYS.PREFERENCES);
  if (!saved) return getDefaultPreferences();
  // Merge with defaults to handle new fields added in future updates
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

export async function savePreferences(prefs: Preferences): Promise<void> {
  await storage.set(STORAGE_KEYS.PREFERENCES, prefs);
}
