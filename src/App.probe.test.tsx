import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { useAuthState, type AuthContextValue } from "./hooks/useAuth";
vi.mock("./hooks/useAuth", () => ({
  useAuthState: vi.fn(), useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./contexts/AppProviders", () => ({ default: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
beforeEach(() => vi.clearAllMocks());
it("does not mount the ordinary auth hook for a native fixture run", () => {
  render(<App probeAuth={{ isAuthenticated: true } as AuthContextValue} />);
  expect(useAuthState).not.toHaveBeenCalled();
});
it("retains the ordinary auth hook without native fixture bootstrap", () => {
  render(<App />);
  expect(useAuthState).toHaveBeenCalledOnce();
});
