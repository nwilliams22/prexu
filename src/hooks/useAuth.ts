import { useState, useEffect, useCallback, createContext, useContext } from "react";
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
import { validateToken, getPlexUser, onAuthInvalid } from "../services/plex-api";

const TOKEN_REVALIDATION_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  serverSelected: boolean;
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

/** Hook to access auth state from any component */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;

  // Fallback: standalone hook (used at the App level before context is set up)
  return useAuthState();
}

/** Core auth state management hook */
export function useAuthState(): AuthContextValue {
  const [isLoading, setIsLoading] = useState(true);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [server, setServer] = useState<ServerData | null>(null);
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);

  // On mount, migrate storage then check for existing auth
  useEffect(() => {
    (async () => {
      try {
        // Migrate sensitive data from localStorage to secure store (no-op if already done)
        await migrateToSecureStorage();

        const stored = await getAuth();
        if (stored?.authToken) {
          // Validate the token is still good
          const valid = await validateToken(stored.authToken);
          if (valid) {
            setAuthToken(stored.authToken);

            // Also restore server selection
            const storedServer = await getServer();
            if (storedServer) {
              setServer(storedServer);
            }

            // Restore active user profile
            const storedUser = await getActiveUser();
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

  return {
    isLoading,
    isAuthenticated: authToken !== null,
    serverSelected: server !== null,
    authToken,
    server,
    activeUser,
    login,
    logout,
    selectServer,
    changeServer,
    switchUser,
  };
}
