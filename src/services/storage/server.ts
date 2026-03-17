/**
 * Server and relay URL storage.
 */

import type { ServerData } from "../../types/plex";
import { STORAGE_KEYS, storageFor, localStore } from "./backends";

const DEFAULT_RELAY_PORT = 9847;

// ── Server data ──

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
