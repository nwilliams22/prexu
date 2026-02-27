/**
 * Storage abstraction layer.
 *
 * On desktop (Tauri), this uses tauri-plugin-store for secure persistent storage.
 * This abstraction exists so we can swap in a different backend for smart TV
 * platforms later (e.g., localStorage, AsyncStorage, etc.) without changing
 * any consuming code.
 */

import type { AuthData, ServerData } from "../types/plex";

const STORAGE_KEYS = {
  AUTH: "auth_data",
  SERVER: "server_data",
  CLIENT_ID: "client_identifier",
  RELAY_URL: "prexu_relay_url",
} as const;

const DEFAULT_RELAY_URL = "ws://localhost:8080/ws";

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

/** Get stored relay server URL */
export async function getRelayUrl(): Promise<string> {
  const url = await storage.get<string>(STORAGE_KEYS.RELAY_URL);
  return url ?? DEFAULT_RELAY_URL;
}

/** Save relay server URL */
export async function saveRelayUrl(url: string): Promise<void> {
  await storage.set(STORAGE_KEYS.RELAY_URL, url);
}
