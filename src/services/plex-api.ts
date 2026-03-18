/**
 * Plex API client for server discovery and general API requests.
 */

import type { PlexResource, PlexServer, PlexConnection } from "../types/plex";
import { logger } from "./logger";
import type { HomeUser } from "../types/home-user";
import { getClientIdentifier } from "./storage";

const PLEX_TV_API = "https://clients.plex.tv/api/v2";
const APP_NAME = "Prexu";
const CONNECTIVITY_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 15000;

// ── Request deduplication ──
// For identical GET requests that are already in-flight, return the existing promise.
const inflightRequests = new Map<string, Promise<Response>>();

/**
 * Fetch with automatic timeout. Wraps the native fetch with an AbortController.
 * GET requests are deduplicated: if an identical URL is already in-flight,
 * the existing promise is returned instead of firing a duplicate request.
 */
export async function timedFetch(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const timeout = init?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const method = (init?.method ?? "GET").toUpperCase();

  // Dedup GET requests
  if (method === "GET" && inflightRequests.has(url)) {
    return inflightRequests.get(url)!.then((r) => r.clone());
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // Merge any existing signal (unlikely but safe)
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;

  const promise = fetch(url, { ...init, signal, timeoutMs: undefined } as RequestInit)
    .finally(() => {
      clearTimeout(timer);
      if (method === "GET") inflightRequests.delete(url);
    });

  if (method === "GET") {
    inflightRequests.set(url, promise);
  }

  return promise;
}

// ── Auth invalidation event bus ──
// Components can subscribe to be notified when a 401 is received from any API call.
type AuthInvalidListener = () => void;
const authInvalidListeners = new Set<AuthInvalidListener>();

/** Subscribe to auth invalidation events. Returns an unsubscribe function. */
export function onAuthInvalid(listener: AuthInvalidListener): () => void {
  authInvalidListeners.add(listener);
  return () => {
    authInvalidListeners.delete(listener);
  };
}

function emitAuthInvalid(): void {
  for (const listener of authInvalidListeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors
    }
  }
}

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
    const headers = await getServerHeaders(token);
    const response = await timedFetch(`${uri}/identity`, {
      headers,
      timeoutMs: CONNECTIVITY_TIMEOUT_MS,
    });
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

  const response = await timedFetch(
    `${PLEX_TV_API}/resources?includeHttps=1&includeRelay=1`,
    { headers },
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
    const response = await timedFetch(`${PLEX_TV_API}/user`, { headers });

    if (response.status === 401) {
      emitAuthInvalid();
    }

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
  const response = await timedFetch(`${serverUri}${path}`, { headers });

  if (response.status === 401) {
    emitAuthInvalid();
  }

  return response;
}

// ── Server Account ID ──

/** Fetch the current user's account ID for use with the history endpoint */
export async function getServerAccountId(
  serverUri: string,
  serverToken: string
): Promise<number | null> {
  const TAG = "WatchHistory";
  try {
    const headers = await getServerHeaders(serverToken);

    // Strategy 1: Fetch /myplex/account which returns the authenticated user's
    // MyPlex account info — try multiple known response shapes
    const myPlexResp = await timedFetch(`${serverUri}/myplex/account`, { headers });
    if (myPlexResp.ok) {
      const data = await myPlexResp.json();
      logger.info(TAG, "/myplex/account response:", JSON.stringify(data).slice(0, 500));
      const id =
        data?.MyPlex?.id ??
        data?.MediaContainer?.MyPlex?.id ??
        data?.id ??
        data?.MediaContainer?.id ??
        null;
      if (typeof id === "number" && id > 0) {
        logger.info(TAG, "Found account ID from /myplex/account:", id);
        return id;
      }
      if (typeof id === "string" && id.length > 0) {
        const parsed = parseInt(id, 10);
        if (!isNaN(parsed) && parsed > 0) {
          logger.info(TAG, "Found account ID (parsed string) from /myplex/account:", parsed);
          return parsed;
        }
      }
      logger.warn(TAG, "/myplex/account returned no usable ID, extracted:", id);
    } else {
      logger.warn(TAG, "/myplex/account failed with status:", myPlexResp.status);
    }

    // Strategy 2: Check the server root which includes myPlexUsername,
    // then match against /accounts
    const [rootResp, accountsResp] = await Promise.all([
      timedFetch(`${serverUri}/`, { headers }),
      timedFetch(`${serverUri}/accounts`, { headers }),
    ]);
    if (rootResp.ok && accountsResp.ok) {
      const rootData = await rootResp.json();
      const accountsData = await accountsResp.json();
      const accounts: Array<{ id: number; name: string }> =
        accountsData?.MediaContainer?.Account ?? [];
      const myPlexUsername: string =
        rootData?.MediaContainer?.myPlexUsername ?? "";

      logger.info(TAG, "Server root myPlexUsername:", myPlexUsername);
      logger.info(TAG, "/accounts list:", accounts.map((a) => `${a.id}=${a.name}`).join(", "));

      if (myPlexUsername && accounts.length > 0) {
        const exact = accounts.find((a) => a.name === myPlexUsername);
        if (exact) {
          logger.info(TAG, "Matched account by username:", `${exact.id}=${exact.name}`);
          return exact.id;
        }
        const lower = myPlexUsername.toLowerCase();
        const insensitive = accounts.find(
          (a) => a.name.toLowerCase() === lower
        );
        if (insensitive) {
          logger.info(TAG, "Matched account (case-insensitive):", `${insensitive.id}=${insensitive.name}`);
          return insensitive.id;
        }
        logger.warn(TAG, "No username match found for:", myPlexUsername);
      }

      // Fallback: server owner is always account id 1
      if (accounts.length > 0) {
        const owner = accounts.find((a) => a.id === 1);
        if (owner) {
          logger.info(TAG, "Falling back to owner account id 1:", owner.name);
          return owner.id;
        }
      }
    } else {
      logger.warn(TAG, "Root or /accounts failed:", `${rootResp.status}, ${accountsResp.status}`);
    }

    logger.warn(TAG, "All strategies failed, returning null (no filter)");
    return null;
  } catch (err) {
    logger.error(TAG, "getServerAccountId error:", err);
    return null;
  }
}

// ── Plex User & Friends API ──

export interface PlexUser {
  id: number;
  username: string;
  email: string;
  friendlyName: string;
  thumb: string;
}

export interface PlexFriend {
  id: number;
  username: string;
  email: string;
  friendlyName: string;
  thumb: string;
  status: string;
  home: boolean;
}

/** Fetch the current authenticated user's profile */
export async function getPlexUser(authToken: string): Promise<PlexUser> {
  const headers = await getAuthHeaders(authToken);
  const response = await timedFetch(`${PLEX_TV_API}/user`, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch user profile: ${response.status}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    username: data.username ?? data.title ?? "",
    email: data.email ?? "",
    friendlyName: data.friendlyName ?? data.title ?? "",
    thumb: data.thumb ?? "",
  };
}

/** Fetch the user's Plex friends list */
export async function getPlexFriends(
  authToken: string
): Promise<PlexFriend[]> {
  const headers = await getAuthHeaders(authToken);

  // Try v2 JSON endpoint first
  try {
    const response = await timedFetch(`${PLEX_TV_API}/friends`, { headers });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        return data.map((f: Record<string, unknown>) => ({
          id: (f.id as number) ?? 0,
          username: (f.username as string) ?? (f.title as string) ?? "",
          email: (f.email as string) ?? "",
          friendlyName:
            (f.friendlyName as string) ?? (f.title as string) ?? "",
          thumb: (f.thumb as string) ?? "",
          status: (f.status as string) ?? "accepted",
          home: (f.home as boolean) ?? false,
        }));
      }
    }
  } catch {
    // Fall through to v1 XML endpoint
  }

  // Fallback: v1 XML endpoint
  try {
    const xmlHeaders = { ...headers, Accept: "application/xml" };
    const response = await timedFetch("https://plex.tv/api/users", {
      headers: xmlHeaders,
    });

    if (!response.ok) {
      throw new Error(`Friends API failed: ${response.status}`);
    }

    const xml = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    const userElements = doc.querySelectorAll("User");

    return Array.from(userElements).map((el) => ({
      id: parseInt(el.getAttribute("id") ?? "0", 10),
      username: el.getAttribute("username") ?? el.getAttribute("title") ?? "",
      email: el.getAttribute("email") ?? "",
      friendlyName:
        el.getAttribute("friendlyName") ??
        el.getAttribute("title") ??
        "",
      thumb: el.getAttribute("thumb") ?? "",
      status: el.getAttribute("status") ?? "accepted",
      home: el.getAttribute("home") === "1",
    }));
  } catch (err) {
    throw new Error(
      `Failed to fetch friends: ${err instanceof Error ? err.message : "Unknown error"}`
    );
  }
}

// ── Plex Home Users API ──

/**
 * Fetch all users in the Plex Home.
 * Returns empty array if the account is not part of a Plex Home.
 */
export async function getHomeUsers(authToken: string): Promise<HomeUser[]> {
  const headers = await getAuthHeaders(authToken);

  try {
    const response = await timedFetch(`${PLEX_TV_API}/home/users`, { headers });

    if (!response.ok) {
      // 401 or 403 means not a Plex Home member — graceful degradation
      if (response.status === 401 || response.status === 403) {
        return [];
      }
      throw new Error(`Failed to fetch home users: ${response.status}`);
    }

    const data = await response.json();
    const users = Array.isArray(data) ? data : (data.users ?? []);

    return users.map((u: Record<string, unknown>) => ({
      id: (u.id as number) ?? 0,
      uuid: (u.uuid as string) ?? "",
      title: (u.title as string) ?? (u.username as string) ?? "",
      username: (u.username as string) ?? "",
      thumb: (u.thumb as string) ?? "",
      admin: (u.admin as boolean) ?? false,
      guest: (u.guest as boolean) ?? false,
      restricted: (u.restricted as boolean) ?? false,
      home: (u.home as boolean) ?? false,
      protected: (u.protected as boolean) ?? false,
    }));
  } catch (err) {
    console.warn("[plex-api] Could not fetch home users:", err);
    return [];
  }
}

/**
 * Switch to a different Plex Home user.
 * Returns a new auth token for that user.
 * If the user has a PIN, it must be provided.
 */
export async function switchHomeUser(
  authToken: string,
  userId: number,
  pin?: string
): Promise<string> {
  const headers = await getAuthHeaders(authToken);

  const body = new URLSearchParams();
  if (pin) {
    body.set("pin", pin);
  }

  const response = await timedFetch(`${PLEX_TV_API}/home/users/${userId}/switch`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Incorrect PIN");
    }
    throw new Error(`Failed to switch user: ${response.status}`);
  }

  const data = await response.json();
  const newToken = data.authToken ?? data.authentication_token;

  if (!newToken) {
    throw new Error("No auth token returned from user switch");
  }

  return newToken as string;
}
