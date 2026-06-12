/**
 * Server reachability probe helpers.
 *
 * Provides a lightweight check against a Plex server's /identity endpoint
 * to determine whether a stored server URI is still reachable.
 */

import { getServerHeaders } from "./plex-api";
import { logger } from "./logger";

const PROBE_TIMEOUT_MS = 5000;

async function probeOnce(serverUri: string, serverToken: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const headers = await getServerHeaders(serverToken);
    const response = await fetch(`${serverUri}/identity`, {
      headers,
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe whether a Plex server URI is reachable by hitting /identity.
 *
 * Uses AbortController for timeout so the probe never hangs. Returns true
 * when the server responds with any HTTP success status.
 *
 * `attempts` > 1 retries the same URI before giving up. A failed probe
 * escalates to a full plex.tv discovery sweep at the call site (~11s of
 * background probing plus a server-state swap), so a cheap retry that
 * absorbs cold-boot contention is much cheaper than a false negative.
 */
export async function probeServerReachability(
  serverUri: string,
  serverToken: string,
  attempts = 1
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (await probeOnce(serverUri, serverToken)) return true;
    if (attempt < attempts) {
      logger.debug("auth", "reachability probe failed, retrying", {
        attempt,
        of: attempts,
      });
    }
  }
  return false;
}

/**
 * Given the raw PlexServer list from discoverServers(), find the entry
 * matching storedClientId and return a ServerData-compatible object if
 * the server is online.
 *
 * Reuses the same connection-selection logic as discoverServers
 * (best URI is already resolved there), so we just take it as-is.
 */
export function resolveServerFromDiscovery(
  servers: import("../types/plex").PlexServer[],
  storedClientId: string
): import("../types/plex").ServerData | null {
  const match = servers.find(
    (s) => s.clientIdentifier === storedClientId && s.status === "online"
  );

  if (!match) return null;

  return {
    name: match.name,
    clientIdentifier: match.clientIdentifier,
    accessToken: match.accessToken,
    uri: match.uri,
  };
}

/**
 * Log a re-resolve event, truncating URIs to 80 chars to avoid
 * leaking full tokens in logs.
 */
export function logServerResolve(oldUri: string, newUri: string): void {
  const truncOld = oldUri.substring(0, 80);
  const truncNew = newUri.substring(0, 80);
  logger.info("auth", "server URI re-resolved", { from: truncOld, to: truncNew });
}
