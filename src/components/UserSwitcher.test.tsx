import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import UserSwitcher from "./UserSwitcher";
import type { AuthContextValue } from "../hooks/useAuth";
import type { HomeUsersContextValue } from "../hooks/useHomeUsers";
import type { HomeUser } from "../types/home-user";

// Mock the hooks
vi.mock("../hooks/useAuth", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../hooks/useAuth");
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

vi.mock("../hooks/useHomeUsers", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../hooks/useHomeUsers");
  return {
    ...actual,
    useHomeUsers: vi.fn(),
  };
});

import { useAuth } from "../hooks/useAuth";
import { useHomeUsers } from "../hooks/useHomeUsers";

const mockUseAuth = vi.mocked(useAuth);
const mockUseHomeUsers = vi.mocked(useHomeUsers);

function renderUserSwitcher() {
  return render(
    <BrowserRouter>
      <UserSwitcher />
    </BrowserRouter>
  );
}

describe("UserSwitcher", () => {
  const defaultAuth: AuthContextValue = {
    isLoading: false,
    isAuthenticated: true,
    serverSelected: true,
    authToken: "test-token",
    server: {
      name: "My Server",
      uri: "http://localhost:32400",
      accessToken: "server-token",
      clientIdentifier: "abc123",
    },
    activeUser: {
      id: 1,
      title: "Alice",
      username: "alice",
      thumb: "/alice.jpg",
      isAdmin: true,
      isHomeUser: true,
    },
    login: vi.fn(),
    logout: vi.fn(),
    selectServer: vi.fn(),
    changeServer: vi.fn(),
    switchUser: vi.fn(),
  };

  const homeUsers: HomeUser[] = [
    { id: 1, uuid: "u1", title: "Alice", username: "alice", thumb: "/alice.jpg", admin: true, guest: false, restricted: false, home: true, protected: false },
    { id: 2, uuid: "u2", title: "Bob", username: "bob", thumb: "/bob.jpg", admin: false, guest: false, restricted: false, home: true, protected: true },
    { id: 3, uuid: "u3", title: "Charlie", username: "charlie", thumb: "", admin: false, guest: false, restricted: false, home: true, protected: false },
  ];

  const defaultHomeUsers: HomeUsersContextValue = {
    homeUsers,
    isLoading: false,
    isPlexHome: true,
    isSwitching: false,
    switchError: null,
    switchTo: vi.fn(),
    clearError: vi.fn(),
  };

  beforeEach(() => {
    mockUseAuth.mockReturnValue(defaultAuth);
    mockUseHomeUsers.mockReturnValue(defaultHomeUsers);
  });

  it("renders the server name", () => {
    renderUserSwitcher();
    expect(screen.getByText("My Server")).toBeInTheDocument();
  });

  it("shows user avatar button", () => {
    renderUserSwitcher();
    const avatarButton = screen.getByTitle("Alice");
    expect(avatarButton).toBeInTheDocument();
  });

  it("opens dropdown when avatar is clicked", async () => {
    const user = userEvent.setup();
    renderUserSwitcher();

    await user.click(screen.getByTitle("Alice"));

    // Dropdown should show current user name + actions
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Sign Out")).toBeInTheDocument();
  });

  it("shows admin badge for admin user", async () => {
    const user = userEvent.setup();
    renderUserSwitcher();

    await user.click(screen.getByTitle("Alice"));
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("shows Switch User section when isPlexHome is true", async () => {
    const user = userEvent.setup();
    renderUserSwitcher();

    await user.click(screen.getByTitle("Alice"));
    expect(screen.getByText("Switch User")).toBeInTheDocument();

    // All home users should be listed
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("does not show Switch User when isPlexHome is false", async () => {
    const user = userEvent.setup();
    mockUseHomeUsers.mockReturnValue({ ...defaultHomeUsers, isPlexHome: false });

    renderUserSwitcher();
    await user.click(screen.getByTitle("Alice"));

    expect(screen.queryByText("Switch User")).not.toBeInTheDocument();
  });

  it("calls switchTo for unprotected user", async () => {
    const user = userEvent.setup();
    const switchTo = vi.fn();
    mockUseHomeUsers.mockReturnValue({ ...defaultHomeUsers, switchTo });

    renderUserSwitcher();
    await user.click(screen.getByTitle("Alice"));
    await user.click(screen.getByText("Charlie"));

    expect(switchTo).toHaveBeenCalledWith(homeUsers[2]);
  });

  it("does not call switchTo directly for protected user (requires PIN)", async () => {
    const user = userEvent.setup();
    const switchTo = vi.fn();
    mockUseHomeUsers.mockReturnValue({ ...defaultHomeUsers, switchTo });

    renderUserSwitcher();
    await user.click(screen.getByTitle("Alice"));
    await user.click(screen.getByText("Bob"));

    // switchTo should NOT be called directly — PIN modal is needed first
    expect(switchTo).not.toHaveBeenCalled();
  });

  it("calls logout when Sign Out is clicked", async () => {
    const user = userEvent.setup();
    const logout = vi.fn();
    mockUseAuth.mockReturnValue({ ...defaultAuth, logout });

    renderUserSwitcher();
    await user.click(screen.getByTitle("Alice"));
    await user.click(screen.getByText("Sign Out"));

    expect(logout).toHaveBeenCalledOnce();
  });

  it("calls changeServer when Change Server is clicked", async () => {
    const user = userEvent.setup();
    const changeServer = vi.fn();
    mockUseAuth.mockReturnValue({ ...defaultAuth, changeServer });

    renderUserSwitcher();
    await user.click(screen.getByTitle("Alice"));
    await user.click(screen.getByText("Change Server"));

    expect(changeServer).toHaveBeenCalledOnce();
  });

  it("does not call switchTo when clicking active user", async () => {
    const user = userEvent.setup();
    const switchTo = vi.fn();
    mockUseHomeUsers.mockReturnValue({ ...defaultHomeUsers, switchTo });

    renderUserSwitcher();
    await user.click(screen.getByTitle("Alice"));

    // Find and click the "Alice" user item in the list
    const aliceItems = screen.getAllByText("Alice");
    // Click the user item (the one in the user list, not the header)
    const userListAlice = aliceItems[aliceItems.length - 1];
    await user.click(userListAlice);

    // Should NOT call switchTo for same user
    expect(switchTo).not.toHaveBeenCalled();
  });

  it("shows avatar fallback when no thumb", () => {
    mockUseAuth.mockReturnValue({
      ...defaultAuth,
      activeUser: { ...defaultAuth.activeUser!, thumb: "" },
    });

    renderUserSwitcher();
    // Should show first letter
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});
