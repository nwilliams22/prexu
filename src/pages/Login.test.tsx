import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Login from "./Login";

const mockLogin = vi.fn(() => Promise.resolve());
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ login: mockLogin }),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(() => Promise.resolve()),
}));

const mockCreatePin = vi.fn(() => Promise.resolve({ id: 1, code: "ABCD" }));
const mockGetAuthUrl = vi.fn(() => Promise.resolve("https://plex.tv/auth"));
const mockPollForAuth = vi.fn(() => Promise.resolve("auth-token-123"));
vi.mock("../services/plex-auth", () => ({
  createPin: (...args: unknown[]) => mockCreatePin(...args),
  getAuthUrl: (...args: unknown[]) => mockGetAuthUrl(...args),
  pollForAuth: (...args: unknown[]) => mockPollForAuth(...args),
}));

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default implementations after tests that override them
    mockCreatePin.mockImplementation(() => Promise.resolve({ id: 1, code: "ABCD" }));
    mockGetAuthUrl.mockImplementation(() => Promise.resolve("https://plex.tv/auth"));
    mockPollForAuth.mockImplementation(() => Promise.resolve("auth-token-123"));
  });

  it("renders app title 'Prexu'", () => {
    render(<Login />);
    expect(screen.getByText("Prexu")).toBeInTheDocument();
  });

  it("renders 'Sign in with Plex' button", () => {
    render(<Login />);
    expect(screen.getByText("Sign in with Plex")).toBeInTheDocument();
  });

  it("shows waiting state after clicking sign in", async () => {
    // Make pollForAuth hang so we stay in waiting state
    mockPollForAuth.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();

    render(<Login />);
    await user.click(screen.getByText("Sign in with Plex"));

    expect(screen.getByText("Waiting for you to sign in...")).toBeInTheDocument();
  });

  it("opens auth URL in browser via Tauri shell", async () => {
    mockPollForAuth.mockImplementation(() => new Promise(() => {}));
    const { open } = await import("@tauri-apps/plugin-shell");
    const user = userEvent.setup();

    render(<Login />);
    await user.click(screen.getByText("Sign in with Plex"));

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith("https://plex.tv/auth");
    });
  });

  it("calls login with auth token after polling", async () => {
    const user = userEvent.setup();

    render(<Login />);
    await user.click(screen.getByText("Sign in with Plex"));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("auth-token-123");
    });
  });

  it("shows error state on auth failure", async () => {
    mockCreatePin.mockImplementation(() =>
      Promise.reject(new Error("Network error"))
    );
    const user = userEvent.setup();

    render(<Login />);
    await user.click(screen.getByText("Sign in with Plex"));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("shows 'Try Again' button on error", async () => {
    mockCreatePin.mockImplementation(() =>
      Promise.reject(new Error("Auth failed"))
    );
    const user = userEvent.setup();

    render(<Login />);
    await user.click(screen.getByText("Sign in with Plex"));

    await waitFor(() => {
      expect(screen.getByText("Try Again")).toBeInTheDocument();
    });
  });

  it("shows Cancel button during waiting", async () => {
    mockPollForAuth.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();

    render(<Login />);
    await user.click(screen.getByText("Sign in with Plex"));

    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });
});
