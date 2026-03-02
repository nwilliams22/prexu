import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";
import { getHomeUsers, switchHomeUser, discoverServers } from "../services/plex-api";
import type { HomeUser, ActiveUser } from "../types/home-user";

export interface HomeUsersContextValue {
  homeUsers: HomeUser[];
  isLoading: boolean;
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
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Fetch home users when auth token is available
  useEffect(() => {
    if (!authToken) {
      setHomeUsers([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      const users = await getHomeUsers(authToken);
      if (!cancelled) {
        setHomeUsers(users);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authToken]);

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
          await selectServer({
            name: onlineServers[0].name,
            clientIdentifier: onlineServers[0].clientIdentifier,
            accessToken: onlineServers[0].accessToken,
            uri: onlineServers[0].uri,
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

  return {
    homeUsers,
    isLoading,
    isPlexHome: homeUsers.length >= 2,
    isSwitching,
    switchError,
    switchTo,
    clearError,
  };
}
