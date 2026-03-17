import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuthState } from "./useAuth";

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
}));

import * as storage from "../services/storage";
import * as plexApi from "../services/plex-api";

const mockStorage = vi.mocked(storage);
const mockPlexApi = vi.mocked(plexApi);

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
