import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import UserSwitcher from "./UserSwitcher";

vi.mock("../hooks/useAuth", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../hooks/useAuth");
  return { ...actual, useAuth: vi.fn() };
});

vi.mock("../hooks/useHomeUsers", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../hooks/useHomeUsers");
  return { ...actual, useHomeUsers: vi.fn() };
});

import { useAuth } from "../hooks/useAuth";
import { useHomeUsers } from "../hooks/useHomeUsers";

const mockUseAuth = vi.mocked(useAuth);
const mockUseHomeUsers = vi.mocked(useHomeUsers);

describe("UserSwitcher a11y", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      serverSelected: true,
      authToken: "token",
      server: { name: "Server", uri: "http://localhost", accessToken: "t", clientIdentifier: "c" },
      activeUser: { id: 1, title: "Alice", username: "alice", thumb: "/a.jpg", isAdmin: true, isHomeUser: true },
      login: vi.fn(),
      logout: vi.fn(),
      selectServer: vi.fn(),
      changeServer: vi.fn(),
      switchUser: vi.fn(),
    } as any);
    mockUseHomeUsers.mockReturnValue({
      homeUsers: [],
      isLoading: false,
      isPlexHome: false,
      isSwitching: false,
      switchError: null,
      switchTo: vi.fn(),
      clearError: vi.fn(),
    } as any);
  });

  it("has no axe violations when closed", async () => {
    const { container } = render(
      <BrowserRouter><UserSwitcher /></BrowserRouter>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("trigger button has aria-expanded and aria-haspopup", () => {
    render(<BrowserRouter><UserSwitcher /></BrowserRouter>);
    const trigger = screen.getByTitle("Alice");
    expect(trigger).toHaveAttribute("aria-haspopup", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("has no axe violations when open", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BrowserRouter><UserSwitcher /></BrowserRouter>
    );
    await user.click(screen.getByTitle("Alice"));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("dropdown has menu role", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BrowserRouter><UserSwitcher /></BrowserRouter>
    );
    await user.click(screen.getByTitle("Alice"));
    expect(container.querySelector("[role='menu']")).not.toBeNull();
  });
});
