import { useState, useEffect, useCallback, useMemo, createContext, useContext } from "react";
import type { AuthData, ServerData } from "../types/plex";
import type { ActiveUser } from "../types/home-user";
import {
  getAuth,
  saveAuth,
  clearAuth,
  getServer,
  saveServer,
  clearServer,
  getClientIdentifier,
  getAdminAuth,
  saveAdminAuth,
  saveActiveUser,
  getActiveUser,
  migrateToSecureStorage,
} from "../services/storage";
import { validateToken, getPlexUser, onAuthInvalid, discoverServers } from "../services/plex-api";
import {
  probeServerReachability,
  resolveServerFromDiscovery,
  logServerResolve,
} from "../services/server-reachability";
import { logger, redactUrl } from "../services/logger";
import { prefetchDashboardData } from "../utils/dashboardPrefetch";

const TOKEN_REVALIDATION_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  serverSelected: boolean;
  /** True when the stored server URI is unreachable and auto-re-resolve failed */
  serverUnreachable: boolean;
  authToken: string | null;
  server: ServerData | null;
  activeUser: ActiveUser | null;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  selectServer: (server: ServerData) => Promise<void>;
  changeServer: () => Promise<void>;
  switchUser: (newToken: string, user: ActiveUser) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const AuthProvider = AuthContext.Provider;

/** Hook to access auth state; must be rendered within an AuthProvider */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/** Core auth state management hook */
export function useAuthState(): AuthContextValue {
  const [isLoading, setIsLoading] = useState(true);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [server, setServer] = useState<ServerData | null>(null);
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [serverUnreachable, setServerUnreachable] = useState(false);

  // On mount, migrate storage then check for existing auth
  useEffect(() => {
    (async () => {
      const bootStart = performance.now();
      try {
        // Migrate sensitive data from localStorage to secure store (no-op if
        // already done). Must complete BEFORE getAuth() — pre-migration the
        // auth key still lives in localStorage, and the secure-store read
        // below would (incorrectly) come back empty.
        await migrateToSecureStorage();

        const stored = await getAuth();
        if (stored?.authToken) {
          // Validate the token against plex.tv (network round trip) and read
          // the two local LazyStore entries concurrently — they're
          // independent of each other and of the validation result, so
          // serializing them behind the network hop (the old behavior) just
          // wasted time on every cold boot (prexu-0szx.9).
          const validateTokenPromise = validateToken(stored.authToken);
          const serverPromise = getServer();
          const userPromise = getActiveUser();

          // Optimistic LAN prefetch: as soon as the stored server comes back
          // (a local disk read with no dependency on plex.tv), warm the
          // dashboard cache in parallel with the plex.tv validation instead
          // of waiting for it to resolve first — overlaps the LAN round trip
          // with the cloud one. If validation fails below we simply never
          // surface this data (see dashboardPrefetch.ts for why that's safe).
          void serverPromise.then((storedServer) => {
            if (storedServer) prefetchDashboardData(storedServer);
          });

          const [valid, storedServer, storedUser] = await Promise.all([
            validateTokenPromise,
            serverPromise,
            userPromise,
          ]);

          logger.debug("auth", "boot waterfall settled", {
            elapsedMs: Math.round(performance.now() - bootStart),
            valid,
            hasServer: storedServer != null,
            hasUser: storedUser != null,
          });

          if (valid) {
            setAuthToken(stored.authToken);

            if (storedServer) {
              // Restore optimistically so the UI is not blocked
              setServer(storedServer);

              // Probe reachability in background — do not await before setIsLoading.
              // Two attempts: a single 5s probe false-negatives under cold-boot
              // contention, and the discovery sweep it escalates to costs ~11s
              // plus a server-state swap that re-triggers dashboard fetches.
              void (async () => {
                const reachable = await probeServerReachability(
                  storedServer.uri,
                  storedServer.accessToken,
                  2
                );

                if (reachable) {
                  // All good — clear any stale unreachable flag
                  setServerUnreachable(false);
                  return;
                }

                logger.warn(
                  "auth",
                  "stored server unreachable, attempting re-resolve",
                  redactUrl(storedServer.uri)
                );

                // Attempt to re-discover and find the same server by clientIdentifier
                try {
                  const servers = await discoverServers(stored.authToken);
                  const fresh = resolveServerFromDiscovery(
                    servers,
                    storedServer.clientIdentifier
                  );

                  if (
                    fresh &&
                    fresh.uri === storedServer.uri &&
                    fresh.accessToken === storedServer.accessToken
                  ) {
                    // Probe false-negatived but discovery reached the same
                    // address — the server was fine all along. Swapping in an
                    // identical-but-new server object would re-trigger every
                    // consumer keyed on `server` (dashboard fetches, activity
                    // websocket), so leave state untouched.
                    logger.info(
                      "auth",
                      "re-resolve returned identical server; keeping existing state",
                      redactUrl(storedServer.uri)
                    );
                    setServerUnreachable(false);
                  } else if (fresh) {
                    logServerResolve(storedServer.uri, fresh.uri);
                    await saveServer(fresh);
                    setServer(fresh);
                    setServerUnreachable(false);
                  } else {
                    logger.error(
                      "auth",
                      "server not found in discovery; clientIdentifier not matched",
                      storedServer.clientIdentifier
                    );
                    setServerUnreachable(true);
                  }
                } catch (err) {
                  logger.error(
                    "auth",
                    "discovery failed during server re-resolve",
                    err instanceof Error ? err.message : String(err)
                  );
                  setServerUnreachable(true);
                }
              })();
            }

            // Restore active user profile
            if (storedUser) {
              setActiveUser(storedUser);
            }
          } else {
            // Token expired, clean up
            await clearAuth();
          }
        }
      } catch {
        // Storage or network error, start fresh
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Periodic token revalidation (every 30 minutes)
  useEffect(() => {
    if (!authToken) return;

    const interval = setInterval(async () => {
      const valid = await validateToken(authToken);
      if (!valid) {
        await clearAuth();
        setAuthToken(null);
        setServer(null);
        setActiveUser(null);
      }
    }, TOKEN_REVALIDATION_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [authToken]);

  // Listen for 401 responses from any API call and auto-logout
  useEffect(() => {
    if (!authToken) return;

    return onAuthInvalid(async () => {
      await clearAuth();
      setAuthToken(null);
      setServer(null);
      setActiveUser(null);
    });
  }, [authToken]);

  const login = useCallback(async (token: string) => {
    const clientId = await getClientIdentifier();
    const authData: AuthData = {
      authToken: token,
      clientIdentifier: clientId,
    };
    await saveAuth(authData);
    setAuthToken(token);

    // Set the initial active user from the logged-in Plex account
    try {
      const plexUser = await getPlexUser(token);
      const user: ActiveUser = {
        id: plexUser.id,
        title: plexUser.friendlyName || plexUser.username,
        username: plexUser.username,
        thumb: plexUser.thumb,
        isAdmin: true,
        isHomeUser: false,
      };
      await saveActiveUser(user);
      setActiveUser(user);
    } catch {
      // Non-fatal: user switcher will just not show an avatar
    }
  }, []);

  const logout = useCallback(async () => {
    await clearAuth();
    setAuthToken(null);
    setServer(null);
    setActiveUser(null);
  }, []);

  const selectServer = useCallback(async (serverData: ServerData) => {
    await saveServer(serverData);
    setServer(serverData);
  }, []);

  const changeServer = useCallback(async () => {
    await clearServer();
    setServer(null);
    setServerUnreachable(false);
  }, []);

  const switchUser = useCallback(
    async (newToken: string, user: ActiveUser) => {
      // If this is the first user switch, preserve the current token as admin
      const existingAdmin = await getAdminAuth();
      if (!existingAdmin && authToken) {
        const clientId = await getClientIdentifier();
        await saveAdminAuth({ authToken, clientIdentifier: clientId });
      }

      // Save new auth token
      const clientId = await getClientIdentifier();
      await saveAuth({ authToken: newToken, clientIdentifier: clientId });
      setAuthToken(newToken);

      // Save active user
      await saveActiveUser(user);
      setActiveUser(user);

      // Clear server selection — must re-discover with new token
      await clearServer();
      setServer(null);
    },
    [authToken]
  );

  return useMemo<AuthContextValue>(
    () => ({
      isLoading,
      isAuthenticated: authToken !== null,
      serverSelected: server !== null,
      serverUnreachable,
      authToken,
      server,
      activeUser,
      login,
      logout,
      selectServer,
      changeServer,
      switchUser,
    }),
    [
      isLoading,
      authToken,
      server,
      serverUnreachable,
      activeUser,
      login,
      logout,
      selectServer,
      changeServer,
      switchUser,
    ],
  );
}
