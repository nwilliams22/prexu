import { createElement, type ReactNode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuth, useAuthState, AuthProvider, type AuthContextValue } from "./useAuth";

// Mock storage module
vi.mock("../services/storage", () => ({
  getAuth: vi.fn(),
  saveAuth: vi.fn(),
  clearAuth: vi.fn(),
  getServer: vi.fn(),
  saveServer: vi.fn(),
  clearServer: vi.fn(),
  getClientIdentifier: vi.fn().mockResolvedValue("test-client-id"),
  getAdminAuth: vi.fn(),
  saveAdminAuth: vi.fn(),
  saveActiveUser: vi.fn(),
  getActiveUser: vi.fn(),
  migrateToSecureStorage: vi.fn().mockResolvedValue(undefined),
}));

// Mock plex-api
vi.mock("../services/plex-api", () => ({
  validateToken: vi.fn(),
  getPlexUser: vi.fn(),
  onAuthInvalid: vi.fn().mockReturnValue(() => {}),
  discoverServers: vi.fn().mockResolvedValue([]),
}));

// Mock server-reachability so background probe doesn't touch Tauri in tests
vi.mock("../services/server-reachability", () => ({
  probeServerReachability: vi.fn().mockResolvedValue(true),
  resolveServerFromDiscovery: vi.fn().mockReturnValue(null),
  logServerResolve: vi.fn(),
}));

// Mock logger to avoid Tauri IPC calls in test environment
vi.mock("../services/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/logger")>()),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the optimistic dashboard prefetch so tests don't trigger real
// network/Tauri calls — assert on call args instead (prexu-0szx.9).
vi.mock("../utils/dashboardPrefetch", () => ({
  prefetchDashboardData: vi.fn(),
}));

// Spy on cacheClear while keeping the REAL implementation (and the real
// in-memory store shared with cacheGet/cacheSet) so we can assert both that
// it fires AND that a stale entry is actually gone afterwards (prexu-9f4s.2).
vi.mock("../services/api-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api-cache")>();
  return { ...actual, cacheClear: vi.fn(actual.cacheClear) };
});

import * as storage from "../services/storage";
import * as plexApi from "../services/plex-api";
import * as apiCache from "../services/api-cache";
import { prefetchDashboardData } from "../utils/dashboardPrefetch";

const mockStorage = vi.mocked(storage);
const mockPlexApi = vi.mocked(plexApi);
const mockCacheClear = vi.mocked(apiCache.cacheClear);
const mockPrefetch = vi.mocked(prefetchDashboardData);

describe("useAuthState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no stored auth
    mockStorage.getAuth.mockResolvedValue(null);
    mockStorage.getServer.mockResolvedValue(null);
    mockStorage.getActiveUser.mockResolvedValue(null);
    mockStorage.getAdminAuth.mockResolvedValue(null);
    mockPlexApi.validateToken.mockResolvedValue(false);
  });

  it("starts loading and resolves to unauthenticated when no stored auth", async () => {
    const { result } = renderHook(() => useAuthState());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.authToken).toBeNull();
    expect(result.current.server).toBeNull();
  });

  it("restores auth state when stored token is valid", async () => {
    mockStorage.getAuth.mockResolvedValue({
      authToken: "stored-token",
      clientIdentifier: "client-id",
    });
    mockPlexApi.validateToken.mockResolvedValue(true);
    mockStorage.getServer.mockResolvedValue({
      name: "Server",
      clientIdentifier: "server-id",
      accessToken: "server-token",
      uri: "https://server:32400",
    });
    mockStorage.getActiveUser.mockResolvedValue({
      id: 1,
      title: "User",
      username: "user",
      thumb: "",
      isAdmin: true,
      isHomeUser: false,
    });

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.authToken).toBe("stored-token");
    expect(result.current.server).not.toBeNull();
    expect(result.current.server!.name).toBe("Server");
    expect(result.current.activeUser).not.toBeNull();
    expect(result.current.serverSelected).toBe(true);
  });

  it("clears auth when stored token is invalid", async () => {
    mockStorage.getAuth.mockResolvedValue({
      authToken: "expired-token",
      clientIdentifier: "client-id",
    });
    mockPlexApi.validateToken.mockResolvedValue(false);

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(mockStorage.clearAuth).toHaveBeenCalled();
  });

  it("discards the optimistic prefetch and leaks no state when validation fails, even though the server read raced ahead of it", async () => {
    // The server/user LazyStore reads and the optimistic prefetch fire
    // before validateToken resolves (prexu-0szx.9's parallelized boot) —
    // this asserts that a subsequently-failed validation still results in
    // a fully logged-out state with nothing surfaced from the race.
    mockStorage.getAuth.mockResolvedValue({
      authToken: "expired-token",
      clientIdentifier: "client-id",
    });
    const storedServer = {
      name: "Server",
      clientIdentifier: "server-id",
      accessToken: "server-token",
      uri: "https://server:32400",
    };
    mockStorage.getServer.mockResolvedValue(storedServer);
    mockStorage.getActiveUser.mockResolvedValue({
      id: 1,
      title: "User",
      username: "user",
      thumb: "",
      isAdmin: true,
      isHomeUser: false,
    });
    mockPlexApi.validateToken.mockResolvedValue(false);

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // No leaked optimistic state: fully logged out despite the server read
    // having already resolved (and the prefetch having already fired).
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.authToken).toBeNull();
    expect(result.current.server).toBeNull();
    expect(result.current.activeUser).toBeNull();
    expect(result.current.serverSelected).toBe(false);
    expect(mockStorage.clearAuth).toHaveBeenCalled();
  });

  it("kicks off the dashboard prefetch optimistically, in parallel with token validation", async () => {
    mockStorage.getAuth.mockResolvedValue({
      authToken: "stored-token",
      clientIdentifier: "client-id",
    });
    const storedServer = {
      name: "Server",
      clientIdentifier: "server-id",
      accessToken: "server-token",
      uri: "https://server:32400",
    };
    mockStorage.getServer.mockResolvedValue(storedServer);

    // Slow validateToken so we can assert prefetch already fired before it settles.
    let resolveValidate!: (v: boolean) => void;
    mockPlexApi.validateToken.mockReturnValue(
      new Promise((res) => (resolveValidate = res)),
    );

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => {
      expect(mockPrefetch).toHaveBeenCalledWith(storedServer);
    });
    // Prefetch fired while validation is still pending — the boot hasn't
    // finished yet, proving the two ran in parallel rather than serially.
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveValidate(true);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("login() saves auth, sets token, fetches user", async () => {
    mockPlexApi.getPlexUser.mockResolvedValue({
      id: 42,
      username: "testuser",
      email: "test@example.com",
      friendlyName: "Test User",
      thumb: "/avatar",
    });

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.login("new-token");
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.authToken).toBe("new-token");
    expect(mockStorage.saveAuth).toHaveBeenCalledWith({
      authToken: "new-token",
      clientIdentifier: "test-client-id",
    });
    expect(result.current.activeUser?.title).toBe("Test User");
  });

  it("logout() clears all auth state", async () => {
    // First login
    mockPlexApi.getPlexUser.mockResolvedValue({
      id: 1,
      username: "u",
      email: "",
      friendlyName: "U",
      thumb: "",
    });

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.login("token");
    });

    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.authToken).toBeNull();
    expect(result.current.server).toBeNull();
    expect(result.current.activeUser).toBeNull();
    expect(mockStorage.clearAuth).toHaveBeenCalled();
  });

  it("logout() purges the api cache so a re-login can't read the previous user's data", async () => {
    apiCache.cacheSet(
      "dashboard:https://server:32400:deck",
      [{ ratingKey: "prev-user-ondeck" }],
      60_000,
    );

    mockPlexApi.getPlexUser.mockResolvedValue({
      id: 1,
      username: "u",
      email: "",
      friendlyName: "U",
      thumb: "",
    });

    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.login("token");
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(mockCacheClear).toHaveBeenCalled();
    // The stale entry keyed by server URI is actually gone, so the next
    // identity re-selecting the same URI cannot be served it.
    expect(
      apiCache.cacheGet("dashboard:https://server:32400:deck"),
    ).toBeNull();
  });

  it("switchUser() purges the api cache so the new Home user isn't served the prior user's data", async () => {
    mockStorage.getAdminAuth.mockResolvedValue(null);
    mockStorage.getAuth.mockResolvedValue({
      authToken: "admin-token",
      clientIdentifier: "client-id",
    });
    mockPlexApi.validateToken.mockResolvedValue(true);

    apiCache.cacheSet(
      "dashboard:https://server:32400:deck",
      [{ ratingKey: "prev-user-ondeck" }],
      60_000,
    );

    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const newUser = {
      id: 2,
      title: "Kid",
      username: "kid",
      thumb: "",
      isAdmin: false,
      isHomeUser: true,
    };

    await act(async () => {
      await result.current.switchUser("kid-token", newUser);
    });

    expect(mockCacheClear).toHaveBeenCalled();
    expect(
      apiCache.cacheGet("dashboard:https://server:32400:deck"),
    ).toBeNull();
  });

  it("selectServer() saves server data", async () => {
    const { result } = renderHook(() => useAuthState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const serverData = {
      name: "My Server",
      clientIdentifier: "srv-id",
      accessToken: "srv-token",
      uri: "https://192.168.1.1:32400",
    };

    await act(async () => {
      await result.current.selectServer(serverData);
    });

    expect(result.current.server).toEqual(serverData);
    expect(result.current.serverSelected).toBe(true);
    expect(mockStorage.saveServer).toHaveBeenCalledWith(serverData);
  });

  it("switchUser() preserves admin auth and saves new token", async () => {
    mockStorage.getAdminAuth.mockResolvedValue(null);

    // Start authenticated
    mockStorage.getAuth.mockResolvedValue({
      authToken: "admin-token",
      clientIdentifier: "client-id",
    });
    mockPlexApi.validateToken.mockResolvedValue(true);

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const newUser = {
      id: 2,
      title: "Kid",
      username: "kid",
      thumb: "",
      isAdmin: false,
      isHomeUser: true,
    };

    await act(async () => {
      await result.current.switchUser("kid-token", newUser);
    });

    // Should save admin auth (first switch)
    expect(mockStorage.saveAdminAuth).toHaveBeenCalled();
    // Should update token
    expect(result.current.authToken).toBe("kid-token");
    expect(result.current.activeUser).toEqual(newUser);
    // Server should be cleared (re-discover needed)
    expect(result.current.server).toBeNull();
    expect(mockStorage.clearServer).toHaveBeenCalled();
  });
});

describe("useAuth", () => {
  const contextValue: AuthContextValue = {
    isLoading: false,
    isAuthenticated: true,
    serverSelected: true,
    serverUnreachable: false,
    authToken: "ctx-token",
    server: {
      name: "Ctx Server",
      clientIdentifier: "ctx-server-id",
      accessToken: "ctx-server-token",
      uri: "https://ctx-server:32400",
    },
    activeUser: null,
    login: vi.fn(),
    logout: vi.fn(),
    selectServer: vi.fn(),
    changeServer: vi.fn(),
    switchUser: vi.fn(),
  };

  it("throws when used outside an AuthProvider", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useAuth())).toThrow(
        "useAuth must be used within an AuthProvider"
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("returns the provider's context value when wrapped in AuthProvider", () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AuthProvider, { value: contextValue }, children);

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current).toBe(contextValue);
  });
});
