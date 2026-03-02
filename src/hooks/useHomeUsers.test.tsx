import { renderHook, act, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { useHomeUsersState } from "./useHomeUsers";
import { AuthProvider, type AuthContextValue } from "./useAuth";
import { createHomeUser, createActiveUser, createServerData } from "../__tests__/mocks/plex-data";

// Mock plex-api
vi.mock("../services/plex-api", () => ({
  getHomeUsers: vi.fn(),
  switchHomeUser: vi.fn(),
  discoverServers: vi.fn(),
}));

import * as plexApi from "../services/plex-api";
const mockPlexApi = vi.mocked(plexApi);

function createAuthWrapper(overrides: Partial<AuthContextValue> = {}) {
  const authValue: AuthContextValue = {
    isLoading: false,
    isAuthenticated: true,
    serverSelected: true,
    authToken: "test-token",
    server: createServerData(),
    activeUser: createActiveUser({ id: 1, isAdmin: true }),
    login: vi.fn(),
    logout: vi.fn(),
    selectServer: vi.fn(),
    changeServer: vi.fn(),
    switchUser: vi.fn(),
    ...overrides,
  };

  return {
    authValue,
    wrapper: ({ children }: { children: ReactNode }) => (
      <AuthProvider value={authValue}>{children}</AuthProvider>
    ),
  };
}

describe("useHomeUsersState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlexApi.getHomeUsers.mockResolvedValue([]);
  });

  it("fetches home users when auth token is present", async () => {
    const users = [
      createHomeUser({ id: 1, title: "Admin", admin: true }),
      createHomeUser({ id: 2, title: "Kid", admin: false }),
    ];
    mockPlexApi.getHomeUsers.mockResolvedValue(users);

    const { wrapper } = createAuthWrapper();
    const { result } = renderHook(() => useHomeUsersState(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.homeUsers).toHaveLength(2);
    expect(mockPlexApi.getHomeUsers).toHaveBeenCalledWith("test-token");
  });

  it("isPlexHome is true when users >= 2", async () => {
    mockPlexApi.getHomeUsers.mockResolvedValue([
      createHomeUser({ id: 1 }),
      createHomeUser({ id: 2 }),
    ]);

    const { wrapper } = createAuthWrapper();
    const { result } = renderHook(() => useHomeUsersState(), { wrapper });

    await waitFor(() => {
      expect(result.current.isPlexHome).toBe(true);
    });
  });

  it("isPlexHome is false when fewer than 2 users", async () => {
    mockPlexApi.getHomeUsers.mockResolvedValue([
      createHomeUser({ id: 1 }),
    ]);

    const { wrapper } = createAuthWrapper();
    const { result } = renderHook(() => useHomeUsersState(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isPlexHome).toBe(false);
  });

  it("does not fetch users when no auth token", async () => {
    const { wrapper } = createAuthWrapper({ authToken: null });
    renderHook(() => useHomeUsersState(), { wrapper });

    expect(mockPlexApi.getHomeUsers).not.toHaveBeenCalled();
  });

  it("switchTo() calls switchHomeUser and switchUser", async () => {
    mockPlexApi.getHomeUsers.mockResolvedValue([
      createHomeUser({ id: 1, admin: true }),
      createHomeUser({ id: 2, title: "Kid", admin: false }),
    ]);
    mockPlexApi.switchHomeUser.mockResolvedValue("new-kid-token");
    mockPlexApi.discoverServers.mockResolvedValue([
      {
        name: "Server",
        clientIdentifier: "srv",
        accessToken: "srv-tok",
        uri: "https://srv:32400",
        local: true,
        owned: true,
        status: "online" as const,
      },
    ]);

    const { authValue, wrapper } = createAuthWrapper();
    const { result } = renderHook(() => useHomeUsersState(), { wrapper });

    await waitFor(() => {
      expect(result.current.homeUsers).toHaveLength(2);
    });

    await act(async () => {
      await result.current.switchTo(
        createHomeUser({ id: 2, title: "Kid" })
      );
    });

    expect(mockPlexApi.switchHomeUser).toHaveBeenCalledWith("test-token", 2, undefined);
    expect(authValue.switchUser).toHaveBeenCalledWith(
      "new-kid-token",
      expect.objectContaining({ id: 2, title: "Kid", isHomeUser: true })
    );
  });

  it("switchTo() with PIN passes PIN to API", async () => {
    mockPlexApi.getHomeUsers.mockResolvedValue([
      createHomeUser({ id: 1, admin: true }),
      createHomeUser({ id: 2, protected: true }),
    ]);
    mockPlexApi.switchHomeUser.mockResolvedValue("token-with-pin");
    mockPlexApi.discoverServers.mockResolvedValue([]);

    const { wrapper } = createAuthWrapper();
    const { result } = renderHook(() => useHomeUsersState(), { wrapper });

    await waitFor(() => {
      expect(result.current.homeUsers).toHaveLength(2);
    });

    await act(async () => {
      await result.current.switchTo(
        createHomeUser({ id: 2, protected: true }),
        "1234"
      );
    });

    expect(mockPlexApi.switchHomeUser).toHaveBeenCalledWith("test-token", 2, "1234");
  });

  it("switchTo() sets switchError on failure", async () => {
    mockPlexApi.getHomeUsers.mockResolvedValue([
      createHomeUser({ id: 1, admin: true }),
      createHomeUser({ id: 2 }),
    ]);
    mockPlexApi.switchHomeUser.mockRejectedValue(new Error("Incorrect PIN"));

    const { wrapper } = createAuthWrapper();
    const { result } = renderHook(() => useHomeUsersState(), { wrapper });

    await waitFor(() => {
      expect(result.current.homeUsers).toHaveLength(2);
    });

    await act(async () => {
      await result.current.switchTo(createHomeUser({ id: 2 }), "wrong");
    });

    expect(result.current.switchError).toBe("Incorrect PIN");
    expect(result.current.isSwitching).toBe(false);
  });

  it("clearError() clears the switch error", async () => {
    mockPlexApi.getHomeUsers.mockResolvedValue([
      createHomeUser({ id: 1, admin: true }),
      createHomeUser({ id: 2 }),
    ]);
    mockPlexApi.switchHomeUser.mockRejectedValue(new Error("Error"));

    const { wrapper } = createAuthWrapper();
    const { result } = renderHook(() => useHomeUsersState(), { wrapper });

    await waitFor(() => {
      expect(result.current.homeUsers).toHaveLength(2);
    });

    await act(async () => {
      await result.current.switchTo(createHomeUser({ id: 2 }));
    });

    expect(result.current.switchError).toBe("Error");

    act(() => {
      result.current.clearError();
    });

    expect(result.current.switchError).toBeNull();
  });

  it("does not switch if already on the same user", async () => {
    mockPlexApi.getHomeUsers.mockResolvedValue([
      createHomeUser({ id: 1, admin: true }),
    ]);

    const { wrapper } = createAuthWrapper({
      activeUser: createActiveUser({ id: 1 }),
    });
    const { result } = renderHook(() => useHomeUsersState(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.switchTo(createHomeUser({ id: 1 }));
    });

    expect(mockPlexApi.switchHomeUser).not.toHaveBeenCalled();
  });
});
