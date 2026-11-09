import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "./useAuth";
import { getHomeUsers, switchHomeUser, discoverServers } from "../services/plex-api";
import type { HomeUser, ActiveUser } from "../types/home-user";

export interface HomeUsersContextValue {
  homeUsers: HomeUser[];
  isLoading: boolean;
  loadError?: string | null;
  retryLoad?: () => void;
  isPlexHome: boolean;
  isSwitching: boolean;
  switchError: string | null;
  switchTo: (user: HomeUser, pin?: string) => Promise<void>;
  clearError: () => void;
}

const HomeUsersContext = createContext<HomeUsersContextValue | null>(null);
export const HomeUsersProvider = HomeUsersContext.Provider;

export function useHomeUsers(): HomeUsersContextValue {
  const ctx = useContext(HomeUsersContext);
  if (!ctx) {
    throw new Error("useHomeUsers must be used within HomeUsersProvider");
  }
  return ctx;
}

export function useHomeUsersState(): HomeUsersContextValue {
  const { authToken, activeUser, switchUser, selectServer } = useAuth();
  const [homeUsers, setHomeUsers] = useState<HomeUser[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const retryLoad = useCallback(() => setLoadAttempt((n) => n + 1), []);
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Fetch home users when auth token is available
  useEffect(() => {
    if (!authToken) {
      setHomeUsers([]);
      setIsLoading(false);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    (async () => {
      const users = await getHomeUsers(authToken, true);
      if (!cancelled) {
        setHomeUsers(users);
        setIsLoading(false);
      }
    })().catch(() => {
      if (!cancelled) { setLoadError("Could not load managed users"); setIsLoading(false); }
    });

    return () => {
      cancelled = true;
    };
  }, [authToken, loadAttempt]);

  const switchTo = useCallback(
    async (user: HomeUser, pin?: string) => {
      if (!authToken) return;

      // Don't switch if already on this user
      if (activeUser?.id === user.id) return;

      setIsSwitching(true);
      setSwitchError(null);

      try {
        // 1. Get new token for the target user
        const newToken = await switchHomeUser(authToken, user.id, pin);

        // 2. Build ActiveUser object
        const newActiveUser: ActiveUser = {
          id: user.id,
          title: user.title,
          username: user.username,
          thumb: user.thumb,
          isAdmin: user.admin,
          isHomeUser: true,
        };

        // 3. Switch auth (saves token, clears server)
        await switchUser(newToken, newActiveUser);

        // 4. Re-discover servers with the new token and auto-select
        const servers = await discoverServers(newToken);
        const onlineServers = servers.filter((s) => s.status === "online");
        if (onlineServers.length === 1) {
          const onlineServer = onlineServers[0]!;
          await selectServer({
            name: onlineServer.name,
            clientIdentifier: onlineServer.clientIdentifier,
            accessToken: onlineServer.accessToken,
            uri: onlineServer.uri,
          });
        }
        // If multiple servers, the route guard redirects to /servers
      } catch (err) {
        setSwitchError(
          err instanceof Error ? err.message : "Failed to switch user"
        );
      } finally {
        setIsSwitching(false);
      }
    },
    [authToken, activeUser, switchUser, selectServer]
  );

  const clearError = useCallback(() => setSwitchError(null), []);

  // Memoize so AppProviders' high-frequency re-renders don't hand a new
  // object to every HomeUsers consumer. `isPlexHome` is derived from
  // `homeUsers`, so including `homeUsers` in the deps covers it.
  return useMemo(
    () => ({
      homeUsers,
      isLoading,
      loadError,
      retryLoad,
      isPlexHome: homeUsers.length >= 2,
      isSwitching,
      switchError,
      switchTo,
      clearError,
    }),
    [homeUsers, isLoading, loadError, retryLoad, isSwitching, switchError, switchTo, clearError],
  );
}
