/**
 * Plex API client for server discovery and general API requests.
 */

import type { PlexResource, PlexServer, PlexConnection } from "../types/plex";
import { getClientIdentifier } from "./storage";

const PLEX_TV_API = "https://clients.plex.tv/api/v2";
const APP_NAME = "Prexu";
const CONNECTIVITY_TIMEOUT_MS = 5000;

/** Build headers for authenticated Plex.tv API calls */
async function getAuthHeaders(
  authToken: string
): Promise<Record<string, string>> {
  const clientId = await getClientIdentifier();
  return {
    Accept: "application/json",
    "X-Plex-Product": APP_NAME,
    "X-Plex-Version": "0.1.0",
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Token": authToken,
  };
}

/** Build headers for authenticated requests to a Plex server */
export async function getServerHeaders(
  serverToken: string
): Promise<Record<string, string>> {
  const clientId = await getClientIdentifier();
  return {
    Accept: "application/json",
    "X-Plex-Product": APP_NAME,
    "X-Plex-Version": "0.1.0",
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Token": serverToken,
  };
}

/** Test if a server connection URI is reachable */
async function testConnection(uri: string, token: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      CONNECTIVITY_TIMEOUT_MS
    );

    const headers = await getServerHeaders(token);
    const response = await fetch(`${uri}/identity`, {
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/** Pick the best connection for a resource (prefer local, non-relay) */
async function findBestConnection(
  connections: PlexConnection[],
  accessToken: string
): Promise<{ uri: string; local: boolean } | null> {
  // Sort: local first, then remote, relay last
  const sorted = [...connections].sort((a, b) => {
    if (a.local && !b.local) return -1;
    if (!a.local && b.local) return 1;
    if (!a.relay && b.relay) return -1;
    if (a.relay && !b.relay) return 1;
    return 0;
  });

  // Test connections in parallel, but prefer the sorted order
  const results = await Promise.all(
    sorted.map(async (conn) => ({
      uri: conn.uri,
      local: conn.local,
      ok: await testConnection(conn.uri, accessToken),
    }))
  );

  // Return the first one that works (in priority order)
  const working = results.find((r) => r.ok);
  return working ? { uri: working.uri, local: working.local } : null;
}

/** Discover all available Plex servers for the authenticated user */
export async function discoverServers(
  authToken: string
): Promise<PlexServer[]> {
  const headers = await getAuthHeaders(authToken);

  const response = await fetch(
    `${PLEX_TV_API}/resources?includeHttps=1&includeRelay=1`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to discover servers: ${response.status} ${response.statusText}`
    );
  }

  const resources = (await response.json()) as PlexResource[];

  // Filter to only server-type resources
  const serverResources = resources.filter((r) =>
    r.provides.split(",").includes("server")
  );

  // Resolve each server's best connection
  const servers: PlexServer[] = await Promise.all(
    serverResources.map(async (resource) => {
      const best = await findBestConnection(
        resource.connections,
        resource.accessToken
      );

      return {
        name: resource.name,
        clientIdentifier: resource.clientIdentifier,
        accessToken: resource.accessToken,
        uri: best?.uri ?? resource.connections[0]?.uri ?? "",
        local: best?.local ?? false,
        owned: resource.owned,
        status: best ? ("online" as const) : ("offline" as const),
      };
    })
  );

  return servers;
}

/** Validate that an auth token is still valid */
export async function validateToken(authToken: string): Promise<boolean> {
  try {
    const headers = await getAuthHeaders(authToken);
    const response = await fetch(`${PLEX_TV_API}/user`, { headers });
    return response.ok;
  } catch {
    return false;
  }
}

/** Make an authenticated request to a Plex server */
export async function serverFetch(
  serverUri: string,
  serverToken: string,
  path: string
): Promise<Response> {
  const headers = await getServerHeaders(serverToken);
  return fetch(`${serverUri}${path}`, { headers });
}
