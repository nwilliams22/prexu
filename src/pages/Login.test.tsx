import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Login from "./Login";

const mockLogin = vi.fn(() => Promise.resolve());
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ login: mockLogin }),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(() => Promise.resolve()),
}));

const mockCreatePin = vi.fn((..._args: unknown[]) => Promise.resolve({ id: 1, code: "ABCD" }));
const mockGetAuthUrl = vi.fn((..._args: unknown[]) => Promise.resolve("https://plex.tv/auth"));
const mockPollForAuth = vi.fn((..._args: unknown[]) => Promise.resolve("auth-token-123"));
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
      expect(screen.getByText("Authentication failed or timed out. Please try again.")).toBeInTheDocument();
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("pending sign-in recovery", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockLogin.mockResolvedValue(undefined);
    mockCreatePin.mockResolvedValue({ id: 1, code: "ABCD" });
    mockGetAuthUrl.mockResolvedValue("https://app.plex.tv/auth#?code=TEST");
    mockPollForAuth.mockImplementation(() => new Promise(() => {}));
    const { open } = await import("@tauri-apps/plugin-shell");
    vi.mocked(open).mockResolvedValue(undefined);
  });

  it.each(["cancel", "unmount"])("ignores a late token after %s", async (action) => {
    const poll = deferred<string>();
    mockPollForAuth.mockReturnValueOnce(poll.promise);
    const user = userEvent.setup();
    const view = render(<Login />);
    await user.click(screen.getByRole("button", { name: "Sign in with Plex" }));
    const signal = mockPollForAuth.mock.calls[0][1] as AbortSignal;
    if (action === "cancel") await user.click(screen.getByRole("button", { name: "Cancel" }));
    else view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => poll.resolve("stale-token"));
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("accepts only the new attempt after cancel and restart", async () => {
    const old = deferred<string>();
    const current = deferred<string>();
    mockPollForAuth.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const user = userEvent.setup();
    render(<Login />);
    await user.click(screen.getByRole("button", { name: "Sign in with Plex" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Sign in with Plex" }));
    await act(async () => old.resolve("stale-token"));
    expect(mockLogin).not.toHaveBeenCalled();
    expect(screen.getByText("Waiting for you to sign in...")).toBeInTheDocument();
    await act(async () => current.resolve("current-token"));
    expect(mockLogin).toHaveBeenCalledExactlyOnceWith("current-token");
  });

  it("ignores a late rejection after restarting", async () => {
    const old = deferred<string>();
    mockPollForAuth.mockReturnValueOnce(old.promise);
    const user = userEvent.setup();
    render(<Login />);
    await user.click(screen.getByRole("button", { name: "Sign in with Plex" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Sign in with Plex" }));
    await act(async () => old.reject(new Error("late error")));
    expect(screen.getByText("Waiting for you to sign in...")).toBeInTheDocument();
    expect(screen.queryByText("Try Again")).not.toBeInTheDocument();
  });

  it.each(["pin", "url", "browser"])("stops after cancellation during %s preparation", async (stage) => {
    const pending = deferred<never>();
    const { open } = await import("@tauri-apps/plugin-shell");
    if (stage === "pin") mockCreatePin.mockReturnValueOnce(pending.promise);
    if (stage === "url") mockGetAuthUrl.mockReturnValueOnce(pending.promise);
    if (stage === "browser") vi.mocked(open).mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    render(<Login />);
    await user.click(screen.getByRole("button", { name: "Sign in with Plex" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      const result = stage === "pin" ? { id: 1, code: "ABCD" } : "https://app.plex.tv/auth";
      pending.resolve(result as never);
    });
    expect(mockPollForAuth).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
    if (stage !== "browser") expect(open).not.toHaveBeenCalled();
  });

  it("retries after a poll failure and signs in normally", async () => {
    mockPollForAuth.mockRejectedValueOnce(new Error("expired")).mockResolvedValueOnce("new-token");
    const user = userEvent.setup();
    render(<Login />);
    await user.click(screen.getByRole("button", { name: "Sign in with Plex" }));
    const oldSignal = mockPollForAuth.mock.calls[0][1] as AbortSignal;
    await user.click(screen.getByRole("button", { name: "Try Again" }));
    expect(oldSignal.aborted).toBe(true);
    expect(mockLogin).toHaveBeenCalledExactlyOnceWith("new-token");
  });

  it("copies the current link even when browser launch fails, then completes sign-in", async () => {
    const { open } = await import("@tauri-apps/plugin-shell");
    vi.mocked(open).mockRejectedValueOnce(new Error("private URL must not appear"));
    const poll = deferred<string>();
    mockPollForAuth.mockReturnValueOnce(poll.promise);
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    render(<Login />);
    await user.click(screen.getByRole("button", { name: "Sign in with Plex" }));
    expect(screen.getByText(/Could not open your browser/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy sign-in link" }));
    expect(copy).toHaveBeenCalledWith("https://app.plex.tv/auth#?code=TEST");
    expect(screen.getByRole("status")).toHaveTextContent("Sign-in link copied.");
    await act(async () => poll.resolve("fresh-token"));
    expect(mockLogin).toHaveBeenCalledExactlyOnceWith("fresh-token");
  });

  it("reports clipboard failure and allows copying again", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    render(<Login />);
    await user.click(screen.getByRole("button", { name: "Sign in with Plex" }));
    await user.click(screen.getByRole("button", { name: "Copy sign-in link" }));
    expect(screen.getByRole("status")).toHaveTextContent("Could not copy the link.");
    await user.click(screen.getByRole("button", { name: "Copy sign-in link" }));
    expect(screen.getByRole("status")).toHaveTextContent("Sign-in link copied.");
  });
});
