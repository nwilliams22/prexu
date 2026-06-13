/**
 * Tests for the boot-time server re-resolve logic added to useAuthState.
 *
 * Covers:
 *  - serverUnreachable stays false when probe succeeds
 *  - successful re-resolve: saveServer called, server state updated, serverUnreachable false
 *  - discovery finds nothing: serverUnreachable set to true
 *  - discovery throws: serverUnreachable set to true
 *  - changeServer() clears serverUnreachable
 */

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "@testing-library/react";
import { useAuthState } from "./useAuth";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../services/storage", () => ({
  getAuth: vi.fn(),
  saveAuth: vi.fn(),
  clearAuth: vi.fn(),
  getServer: vi.fn(),
  saveServer: vi.fn(),
  clearServer: vi.fn(),
  getClientIdentifier: vi.fn().mockResolvedValue("test-client-id"),
  getAdminAuth: vi.fn().mockResolvedValue(null),
  saveAdminAuth: vi.fn(),
  saveActiveUser: vi.fn(),
  getActiveUser: vi.fn().mockResolvedValue(null),
  migrateToSecureStorage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/plex-api", () => ({
  validateToken: vi.fn(),
  getPlexUser: vi.fn(),
  onAuthInvalid: vi.fn().mockReturnValue(() => {}),
  discoverServers: vi.fn(),
}));

vi.mock("../services/server-reachability", () => ({
  probeServerReachability: vi.fn(),
  resolveServerFromDiscovery: vi.fn(),
  logServerResolve: vi.fn(),
}));

vi.mock("../services/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/logger")>()),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Typed mock references ─────────────────────────────────────────────────────

import * as storage from "../services/storage";
import * as plexApi from "../services/plex-api";
import * as reachability from "../services/server-reachability";

const mockStorage = vi.mocked(storage);
const mockPlexApi = vi.mocked(plexApi);
const mockReachability = vi.mocked(reachability);

// ── Shared fixtures ───────────────────────────────────────────────────────────

const storedServer = {
  name: "My Server",
  clientIdentifier: "server-old-id",
  accessToken: "old-server-token",
  uri: "https://192.168.1.100:32400",
};

const freshServer = {
  name: "My Server",
  clientIdentifier: "server-old-id",
  accessToken: "new-server-token",
  uri: "https://192.168.1.200:32400",
};

function setupValidAuth() {
  mockStorage.getAuth.mockResolvedValue({
    authToken: "user-auth-token",
    clientIdentifier: "client-id",
  });
  mockPlexApi.validateToken.mockResolvedValue(true);
  mockStorage.getServer.mockResolvedValue(storedServer);
  mockStorage.getActiveUser.mockResolvedValue(null);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useAuthState — server re-resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getAuth.mockResolvedValue(null);
    mockStorage.getServer.mockResolvedValue(null);
    mockStorage.getActiveUser.mockResolvedValue(null);
    mockStorage.getAdminAuth.mockResolvedValue(null);
    mockPlexApi.validateToken.mockResolvedValue(false);
  });

  it("keeps serverUnreachable false when probe succeeds", async () => {
    setupValidAuth();
    mockReachability.probeServerReachability.mockResolvedValue(true);

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Give the background probe time to settle
    await waitFor(() => {
      expect(mockReachability.probeServerReachability).toHaveBeenCalledWith(
        storedServer.uri,
        storedServer.accessToken,
        2
      );
    });

    expect(result.current.serverUnreachable).toBe(false);
    expect(mockPlexApi.discoverServers).not.toHaveBeenCalled();
  });

  it("re-resolves server URI when probe fails but discovery succeeds", async () => {
    setupValidAuth();
    mockReachability.probeServerReachability.mockResolvedValue(false);

    const discoveredServer = {
      name: freshServer.name,
      clientIdentifier: freshServer.clientIdentifier,
      accessToken: freshServer.accessToken,
      uri: freshServer.uri,
      local: true,
      owned: true,
      status: "online" as const,
    };
    mockPlexApi.discoverServers.mockResolvedValue([discoveredServer]);
    mockReachability.resolveServerFromDiscovery.mockReturnValue(freshServer);

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Wait for background re-resolve to complete
    await waitFor(() => {
      expect(mockStorage.saveServer).toHaveBeenCalledWith(freshServer);
    });

    expect(result.current.serverUnreachable).toBe(false);
    expect(result.current.server).toEqual(freshServer);
    expect(mockReachability.logServerResolve).toHaveBeenCalledWith(
      storedServer.uri,
      freshServer.uri
    );
  });

  it("skips saveServer/setServer when re-resolve returns the identical server", async () => {
    setupValidAuth();
    mockReachability.probeServerReachability.mockResolvedValue(false);
    mockPlexApi.discoverServers.mockResolvedValue([]);
    // Discovery lands on the same uri + accessToken the store already has —
    // swapping state would re-trigger every consumer keyed on `server`.
    mockReachability.resolveServerFromDiscovery.mockReturnValue({ ...storedServer });

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await waitFor(() => {
      expect(mockReachability.resolveServerFromDiscovery).toHaveBeenCalled();
    });

    expect(result.current.serverUnreachable).toBe(false);
    expect(mockStorage.saveServer).not.toHaveBeenCalled();
    expect(mockReachability.logServerResolve).not.toHaveBeenCalled();
    expect(result.current.server).toEqual(storedServer);
  });

  it("calls discoverServers with the auth token during re-resolve", async () => {
    setupValidAuth();
    mockReachability.probeServerReachability.mockResolvedValue(false);
    mockPlexApi.discoverServers.mockResolvedValue([]);
    mockReachability.resolveServerFromDiscovery.mockReturnValue(null);

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await waitFor(() => {
      expect(mockPlexApi.discoverServers).toHaveBeenCalledWith("user-auth-token");
    });
  });

  it("sets serverUnreachable=true when discovery returns no matching server", async () => {
    setupValidAuth();
    mockReachability.probeServerReachability.mockResolvedValue(false);
    mockPlexApi.discoverServers.mockResolvedValue([]);
    mockReachability.resolveServerFromDiscovery.mockReturnValue(null);

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await waitFor(() => {
      expect(result.current.serverUnreachable).toBe(true);
    });

    expect(mockStorage.saveServer).not.toHaveBeenCalled();
  });

  it("sets serverUnreachable=true when discoverServers throws", async () => {
    setupValidAuth();
    mockReachability.probeServerReachability.mockResolvedValue(false);
    mockPlexApi.discoverServers.mockRejectedValue(
      new Error("plex.tv unreachable")
    );

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await waitFor(() => {
      expect(result.current.serverUnreachable).toBe(true);
    });
  });

  it("does not probe when no server is stored", async () => {
    mockStorage.getAuth.mockResolvedValue({
      authToken: "user-auth-token",
      clientIdentifier: "client-id",
    });
    mockPlexApi.validateToken.mockResolvedValue(true);
    mockStorage.getServer.mockResolvedValue(null);

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockReachability.probeServerReachability).not.toHaveBeenCalled();
    expect(result.current.serverUnreachable).toBe(false);
  });

  it("changeServer() clears serverUnreachable", async () => {
    setupValidAuth();
    mockReachability.probeServerReachability.mockResolvedValue(false);
    mockPlexApi.discoverServers.mockResolvedValue([]);
    mockReachability.resolveServerFromDiscovery.mockReturnValue(null);

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await waitFor(() => {
      expect(result.current.serverUnreachable).toBe(true);
    });

    await act(async () => {
      await result.current.changeServer();
    });

    expect(result.current.serverUnreachable).toBe(false);
    expect(result.current.server).toBeNull();
    expect(mockStorage.clearServer).toHaveBeenCalled();
  });

  it("resolveServerFromDiscovery is called with correct clientIdentifier", async () => {
    setupValidAuth();
    mockReachability.probeServerReachability.mockResolvedValue(false);
    mockPlexApi.discoverServers.mockResolvedValue([]);
    mockReachability.resolveServerFromDiscovery.mockReturnValue(null);

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await waitFor(() => {
      expect(mockReachability.resolveServerFromDiscovery).toHaveBeenCalledWith(
        [],
        storedServer.clientIdentifier
      );
    });
  });
});
