import { useState, useEffect, useCallback, createContext, useContext } from "react";
import type { AuthData, ServerData } from "../types/plex";
import {
  getAuth,
  saveAuth,
  clearAuth,
  getServer,
  saveServer,
  clearServer,
  getClientIdentifier,
} from "../services/storage";
import { validateToken } from "../services/plex-api";

export interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  serverSelected: boolean;
  authToken: string | null;
  server: ServerData | null;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  selectServer: (server: ServerData) => Promise<void>;
  changeServer: () => Promise<void>;
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

  // On mount, check for existing auth
  useEffect(() => {
    (async () => {
      try {
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

  const login = useCallback(async (token: string) => {
    const clientId = await getClientIdentifier();
    const authData: AuthData = {
      authToken: token,
      clientIdentifier: clientId,
    };
    await saveAuth(authData);
    setAuthToken(token);
  }, []);

  const logout = useCallback(async () => {
    await clearAuth();
    setAuthToken(null);
    setServer(null);
  }, []);

  const selectServer = useCallback(async (serverData: ServerData) => {
    await saveServer(serverData);
    setServer(serverData);
  }, []);

  const changeServer = useCallback(async () => {
    await clearServer();
    setServer(null);
  }, []);

  return {
    isLoading,
    isAuthenticated: authToken !== null,
    serverSelected: server !== null,
    authToken,
    server,
    login,
    logout,
    selectServer,
    changeServer,
  };
}
