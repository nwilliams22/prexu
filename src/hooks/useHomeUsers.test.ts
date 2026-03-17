import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useHomeUsers, useHomeUsersState } from "./useHomeUsers";
import type { HomeUser } from "../types/home-user";

// ── Mocks for useHomeUsersState ──

const mockSwitchUser = vi.fn(() => Promise.resolve());
const mockSelectServer = vi.fn(() => Promise.resolve());
const stableActiveUser = { id: 1, title: "Admin", username: "admin", thumb: "", isAdmin: true, isHomeUser: true };

vi.mock("./useAuth", () => ({
  useAuth: () => ({
    authToken: "test-token",
    activeUser: stableActiveUser,
    switchUser: mockSwitchUser,
    selectServer: mockSelectServer,
  }),
}));

const mockGetHomeUsers = vi.fn(() => Promise.resolve([]));
const mockSwitchHomeUser = vi.fn(() => Promise.resolve("new-token"));
const mockDiscoverServers = vi.fn(() => Promise.resolve([]));
vi.mock("../services/plex-api", () => ({
  getHomeUsers: (...args: unknown[]) => mockGetHomeUsers(...args),
  switchHomeUser: (...args: unknown[]) => mockSwitchHomeUser(...args),
  discoverServers: (...args: unknown[]) => mockDiscoverServers(...args),
}));

const fakeUsers: HomeUser[] = [
  { id: 1, uuid: "u1", title: "Admin", username: "admin", thumb: "", admin: true, guest: false, restricted: false, home: true, protected: false },
  { id: 2, uuid: "u2", title: "Kid", username: "kid", thumb: "", admin: false, guest: false, restricted: false, home: true, protected: false },
];

describe("useHomeUsers (context hook)", () => {
  it("throws when used outside provider", () => {
    expect(() => {
      renderHook(() => useHomeUsers());
    }).toThrow("useHomeUsers must be used within HomeUsersProvider");
  });
});

describe("useHomeUsersState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHomeUsers.mockResolvedValue(fakeUsers);
    mockSwitchHomeUser.mockResolvedValue("new-token");
    mockDiscoverServers.mockResolvedValue([]);
  });

  it("fetches home users on mount", async () => {
    const { result } = renderHook(() => useHomeUsersState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetHomeUsers).toHaveBeenCalledWith("test-token");
    expect(result.current.homeUsers).toEqual(fakeUsers);
  });

  it("isPlexHome is true when 2+ users", async () => {
    const { result } = renderHook(() => useHomeUsersState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isPlexHome).toBe(true);
  });

  it("isPlexHome is false when fewer than 2 users", async () => {
    mockGetHomeUsers.mockResolvedValue([fakeUsers[0]]);

    const { result } = renderHook(() => useHomeUsersState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isPlexHome).toBe(false);
  });

  it("switchTo does nothing for the currently active user", async () => {
    const { result } = renderHook(() => useHomeUsersState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.switchTo(fakeUsers[0]); // id=1, same as activeUser
    });

    expect(mockSwitchHomeUser).not.toHaveBeenCalled();
  });

  it("switchTo switches to a different user", async () => {
    const { result } = renderHook(() => useHomeUsersState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.switchTo(fakeUsers[1]);
    });

    expect(mockSwitchHomeUser).toHaveBeenCalledWith("test-token", 2, undefined);
    expect(mockSwitchUser).toHaveBeenCalledWith("new-token", expect.objectContaining({
      id: 2,
      title: "Kid",
      isHomeUser: true,
    }));
    expect(mockDiscoverServers).toHaveBeenCalledWith("new-token");
  });

  it("switchTo passes PIN when provided", async () => {
    const { result } = renderHook(() => useHomeUsersState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.switchTo(fakeUsers[1], "1234");
    });

    expect(mockSwitchHomeUser).toHaveBeenCalledWith("test-token", 2, "1234");
  });

  it("switchTo auto-selects server when exactly one online", async () => {
    const onlineServer = {
      name: "Home Server",
      clientIdentifier: "s1",
      accessToken: "st",
      uri: "https://plex.test",
      status: "online",
    };
    mockDiscoverServers.mockResolvedValue([onlineServer]);

    const { result } = renderHook(() => useHomeUsersState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.switchTo(fakeUsers[1]);
    });

    expect(mockSelectServer).toHaveBeenCalledWith(expect.objectContaining({
      name: "Home Server",
      uri: "https://plex.test",
    }));
  });

  it("switchTo does not auto-select when multiple servers online", async () => {
    mockDiscoverServers.mockResolvedValue([
      { name: "S1", clientIdentifier: "s1", accessToken: "t1", uri: "u1", status: "online" },
      { name: "S2", clientIdentifier: "s2", accessToken: "t2", uri: "u2", status: "online" },
    ]);

    const { result } = renderHook(() => useHomeUsersState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.switchTo(fakeUsers[1]);
    });

    expect(mockSelectServer).not.toHaveBeenCalled();
  });

  it("switchTo sets error on failure", async () => {
    mockSwitchHomeUser.mockRejectedValue(new Error("PIN required"));

    const { result } = renderHook(() => useHomeUsersState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.switchTo(fakeUsers[1]);
    });

    expect(result.current.switchError).toBe("PIN required");
    expect(result.current.isSwitching).toBe(false);
  });

  it("clearError resets switchError", async () => {
    mockSwitchHomeUser.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useHomeUsersState());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.switchTo(fakeUsers[1]);
    });

    expect(result.current.switchError).toBe("fail");

    act(() => {
      result.current.clearError();
    });

    expect(result.current.switchError).toBeNull();
  });
});
