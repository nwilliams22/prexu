/**
 * Plex API client for server discovery and general API requests.
 */

import type { PlexResource, PlexServer, PlexConnection } from "../types/plex";
import { logger, redactUrl } from "./logger";
import type { HomeUser } from "../types/home-user";
import { getClientIdentifier } from "./storage";
import { cacheGet, cacheSet } from "./api-cache";
import {
  validateResponse,
  plexUserResponseSchema,
  plexResourcesResponseSchema,
} from "./validation";

const PLEX_TV_API = "https://clients.plex.tv/api/v2";
const APP_NAME = "Prexu";
const CONNECTIVITY_TIMEOUT_MS = 5000;
export const REQUEST_TIMEOUT_MS = 15000;
const RETRY_ON_TIMEOUT = 1;

// ── Request deduplication ──
// For identical GET requests that are already in-flight, share the response.
// Keyed by token fingerprint + URL so a request authorized as one user is
// never served to a caller using a different token (e.g. after switchHomeUser).
//
// Each entry tracks a refCount of interested consumers so an AbortSignal from
// ONE consumer (e.g. a React effect unmounting) never kills the underlying
// network request while OTHER consumers are still waiting on it — the shared
// fetch is only aborted once the last interested consumer has left.
interface InflightEntry {
  promise: Promise<Response>;
  /** Drives the actual network request (merged with the per-attempt timeout signal in fetchOnce). */
  controller: AbortController;
  /** Number of callers still interested in this request. */
  refCount: number;
}
const inflightRequests = new Map<string, InflightEntry>();

function releaseConsumer(entry: InflightEntry): void {
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount === 0) {
    logger.debug("api", "timedFetch: last consumer left in-flight request, aborting");
    entry.controller.abort(new DOMException("All consumers aborted", "AbortError"));
  }
}

/**
 * Wrap a shared in-flight entry's response promise for ONE consumer.
 *
 * Registers the consumer against the entry's refcount so the shared network
 * request survives as long as anyone still wants it (see releaseConsumer —
 * it only aborts once refCount hits zero). Consumers that never pass a
 * signal are treated as "always interested" (their departure can't be
 * observed), which is the safe default.
 *
 * If the caller supplies their own AbortSignal, THEIR returned promise
 * rejects immediately when THEY abort — even though the underlying request
 * may keep running to serve other consumers.
 */
function consumeShared(entry: InflightEntry, signal?: AbortSignal): Promise<Response> {
  const dataPromise = entry.promise.then((r) => r.clone());
  if (!signal) return dataPromise;
  if (signal.aborted) {
    releaseConsumer(entry);
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => {
      releaseConsumer(entry);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    dataPromise.then(
      (response) => {
        signal.removeEventListener("abort", onAbort);
        resolve(response);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/** True if the error is a TimeoutError thrown by our timedFetch abort. */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}

/** Non-cryptographic FNV-1a hash, used to fingerprint tokens in dedup keys. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Fingerprint of the auth identity attached to a request, derived from the
 * X-Plex-Token header. The raw token never appears in the dedup key.
 */
function tokenFingerprint(init?: RequestInit): string {
  const headers = init?.headers;
  let token = "";
  if (headers instanceof Headers) {
    token = headers.get("X-Plex-Token") ?? "";
  } else if (Array.isArray(headers)) {
    token =
      headers.find(([k]) => k.toLowerCase() === "x-plex-token")?.[1] ?? "";
  } else if (headers) {
    const record = headers as Record<string, string>;
    token = record["X-Plex-Token"] ?? record["x-plex-token"] ?? "";
  }
  return token ? fnv1a(token) : "anon";
}

/**
 * Fetch with automatic timeout. GET requests retry once on timeout
 * (15s timeout x 2 attempts = 30s worst case); non-idempotent methods
 * (POST/PUT/DELETE) never retry by default to avoid duplicated side
 * effects — callers may opt in with `retries`.
 *
 * GET requests are deduplicated: if an identical URL with the same auth
 * token is already in-flight, the existing response is shared. The shared
 * Response is never consumed directly — every consumer (including the
 * caller that initiated the request) receives a `clone()`, so one caller
 * reading the body cannot break another ("body already used").
 *
 * On timeout, aborts with a `TimeoutError` DOMException carrying the
 * token-redacted URL and elapsed ms so callers see
 * "Request timed out after Xms: <url>" instead of
 * the cryptic default "signal is aborted without reason".
 *
 * If the caller's own `init.signal` is already aborted, this fails fast with
 * an `AbortError` (mirroring native `fetch()` behavior) instead of starting
 * or joining a request.
 */
export async function timedFetch(
  url: string,
  init?: RequestInit & { timeoutMs?: number; retries?: number },
): Promise<Response> {
  const timeout = init?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const method = (init?.method ?? "GET").toUpperCase();
  // Only GETs retry by default; retrying non-idempotent methods on timeout
  // can duplicate side effects (the server may have applied the first call).
  const retries = init?.retries ?? (method === "GET" ? RETRY_ON_TIMEOUT : 0);

  if (method !== "GET") {
    return fetchWithRetry(url, init, timeout, retries, method);
  }

  if (init?.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Dedup GET requests (keyed by token fingerprint + URL)
  const key = `${tokenFingerprint(init)}:${url}`;
  const existing = inflightRequests.get(key);
  if (existing) {
    existing.refCount++;
    return consumeShared(existing, init?.signal ?? undefined);
  }

  // The controller here is the "does anyone still want this?" master signal —
  // separate from the per-attempt timeout controller inside fetchOnce. It's
  // merged into the request in fetchOnce via init.signal.
  const controller = new AbortController();
  const promise = fetchWithRetry(
    url,
    { ...init, signal: controller.signal },
    timeout,
    retries,
    method,
  );
  const entry: InflightEntry = { promise, controller, refCount: 1 };
  inflightRequests.set(key, entry);
  // Detach cleanup as a side-effect; swallow rejection on this chain only
  // (consumers observe the real rejection via their own chains).
  promise
    .finally(() => inflightRequests.delete(key))
    .catch(() => {});

  // Every consumer (including this first caller) gets a clone so bodies are
  // independent; consumeShared also wires up per-consumer abort rejection.
  return consumeShared(entry, init?.signal ?? undefined);
}

async function fetchWithRetry(
  url: string,
  init: (RequestInit & { timeoutMs?: number; retries?: number }) | undefined,
  timeout: number,
  retries: number,
  method: string,
): Promise<Response> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fetchOnce(url, init, timeout);
    } catch (err) {
      if (isTimeoutError(err) && attempt < retries) {
        attempt++;
        logger.warn(
          "api",
          `timedFetch retry ${attempt}/${retries} after timeout`,
          { url: redactUrl(url), method, timeoutMs: timeout },
        );
        continue;
      }
      throw err;
    }
  }
}

async function fetchOnce(
  url: string,
  init: (RequestInit & { timeoutMs?: number; retries?: number }) | undefined,
  timeout: number,
): Promise<Response> {
  const controller = new AbortController();
  const start = Date.now();

  const timer = setTimeout(() => {
    const elapsed = Date.now() - start;
    controller.abort(
      new DOMException(
        `Request timed out after ${elapsed}ms: ${redactUrl(url)}`,
        "TimeoutError",
      ),
    );
  }, timeout);

  // Merge any existing signal (unlikely but safe)
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;

  try {
    return await fetch(url, {
      ...init,
      signal,
      timeoutMs: undefined,
      retries: undefined,
    } as RequestInit);
  } catch (err) {
    // If WebView2/older runtimes throw a generic AbortError when our
    // controller aborted, surface our explicit reason instead.
    if (
      controller.signal.aborted &&
      controller.signal.reason instanceof DOMException &&
      controller.signal.reason.name === "TimeoutError"
    ) {
      throw controller.signal.reason;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

  const rawResources = await response.json();
  validateResponse(plexResourcesResponseSchema, rawResources, "discoverServers");
  const resources = rawResources as PlexResource[];

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

/**
 * Make an authenticated request to a Plex server.
 *
 * `signal` is optional and backward-compatible — pass an AbortController's
 * signal from a fetching effect to cancel a stale request on cleanup (see
 * timedFetch's dedup-safe refcounting: aborting one caller's signal never
 * kills the request while other callers still want it).
 */
export async function serverFetch(
  serverUri: string,
  serverToken: string,
  path: string,
  signal?: AbortSignal
): Promise<Response> {
  const headers = await getServerHeaders(serverToken);
  const response = await timedFetch(`${serverUri}${path}`, { headers, signal });

  if (response.status === 401) {
    emitAuthInvalid();
  }

  return response;
}

// ── Server Account ID ──

const SERVER_ACCOUNT_ID_CACHE_TTL = 30 * 60 * 1000; // 30 minutes — rarely changes within a session

/** Fetch the current user's account ID for use with the history endpoint. */
async function fetchServerAccountId(
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

/**
 * Fetch the current user's account ID for use with the history endpoint.
 *
 * Session-TTL cached (30 min) — the underlying strategy issues 1-3 requests
 * (myplex/account, then root + accounts as a fallback) and the result almost
 * never changes for a given server+token within a session. WatchHistory was
 * re-running this on every mount; now it's a cache hit after the first call.
 */
export async function getServerAccountId(
  serverUri: string,
  serverToken: string
): Promise<number | null> {
  const cacheKey = `server-account-id:${serverUri}:${fnv1a(serverToken)}`;
  const cached = cacheGet<number | null>(cacheKey);
  if (cached !== null) {
    logger.debug("WatchHistory", "getServerAccountId: cache hit", { serverUri, accountId: cached });
    return cached;
  }

  const id = await fetchServerAccountId(serverUri, serverToken);
  if (id !== null) {
    cacheSet(cacheKey, id, SERVER_ACCOUNT_ID_CACHE_TTL);
  }
  return id;
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

  const rawData = await response.json();
  const data = validateResponse(plexUserResponseSchema, rawData, "getPlexUser");
  return {
    id: data.id,
    username: data.username ?? data.title ?? "",
    email: data.email ?? "",
    friendlyName: data.friendlyName ?? data.title ?? "",
    thumb: data.thumb ?? "",
  };
}

/** /api/v2/friends — mutual Plex social-graph friends (people who friended
 *  you back). Returns [] on a 200 with non-array body or a non-200; throws
 *  on network/parse failure so the caller can decide whether to surface it. */
async function fetchV2Friends(authToken: string): Promise<PlexFriend[]> {
  const headers = await getAuthHeaders(authToken);
  const response = await timedFetch(`${PLEX_TV_API}/friends`, { headers });
  if (!response.ok) return [];
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map((f: Record<string, unknown>) => ({
    id: (f.id as number) ?? 0,
    username: (f.username as string) ?? (f.title as string) ?? "",
    email: (f.email as string) ?? "",
    friendlyName: (f.friendlyName as string) ?? (f.title as string) ?? "",
    thumb: (f.thumb as string) ?? "",
    status: (f.status as string) ?? "accepted",
    home: (f.home as boolean) ?? false,
  }));
}

/** /api/users (v1 XML) — users you have shared a library with (whether or
 *  not they are mutual social friends). Returns [] on non-200; throws on
 *  network/parse failure. */
async function fetchV1SharedUsers(authToken: string): Promise<PlexFriend[]> {
  const headers = await getAuthHeaders(authToken);
  const xmlHeaders = { ...headers, Accept: "application/xml" };
  const response = await timedFetch("https://plex.tv/api/users", {
    headers: xmlHeaders,
  });
  if (!response.ok) return [];
  const xml = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const userElements = doc.querySelectorAll("User");
  return Array.from(userElements).map((el) => ({
    id: parseInt(el.getAttribute("id") ?? "0", 10),
    username: el.getAttribute("username") ?? el.getAttribute("title") ?? "",
    email: el.getAttribute("email") ?? "",
    friendlyName:
      el.getAttribute("friendlyName") ?? el.getAttribute("title") ?? "",
    thumb: el.getAttribute("thumb") ?? "",
    status: el.getAttribute("status") ?? "accepted",
    home: el.getAttribute("home") === "1",
  }));
}

/**
 * Fetch the user's Plex Watch-Together-eligible friend list.
 *
 * Merges TWO different Plex APIs because each surfaces a different subset:
 *   - /api/v2/friends   → mutual Plex social-graph friends
 *   - /api/users (v1)   → people the user has shared their server with
 *
 * Plex Web aggregates both. Pre-prexu-0wq the code only called v2 (with v1
 * as a fallback ONLY if v2 threw) which silently truncated the list — users
 * who were shared-with but not mutually friended were invisible. Now both
 * run in parallel and are merged by `id` (v2 wins on duplicate since it's
 * the canonical newer API).
 *
 * Returns whatever subset succeeded if one endpoint fails. Throws only when
 * BOTH endpoints fail — preserves the old single-error behavior for the
 * worst case.
 */
export async function getPlexFriends(
  authToken: string
): Promise<PlexFriend[]> {
  const [v2Result, v1Result] = await Promise.allSettled([
    fetchV2Friends(authToken),
    fetchV1SharedUsers(authToken),
  ]);

  const v2 = v2Result.status === "fulfilled" ? v2Result.value : [];
  const v1 = v1Result.status === "fulfilled" ? v1Result.value : [];

  if (v2Result.status === "rejected" && v1Result.status === "rejected") {
    const v2Err = v2Result.reason instanceof Error
      ? v2Result.reason.message
      : String(v2Result.reason);
    const v1Err = v1Result.reason instanceof Error
      ? v1Result.reason.message
      : String(v1Result.reason);
    throw new Error(`Failed to fetch friends (v2: ${v2Err}; v1: ${v1Err})`);
  }

  // Merge: v2 entries first (they win on id-collision since Map.set is last-
  // write-wins and we set v1 after, but reversing the order keeps v2 fields).
  const byId = new Map<number, PlexFriend>();
  for (const u of v1) byId.set(u.id, u);
  for (const u of v2) byId.set(u.id, u); // v2 overrides v1 on dup
  return Array.from(byId.values());
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
    void logger.warn("api", "could not fetch home users", err);
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
