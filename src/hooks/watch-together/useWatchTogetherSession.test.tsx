import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useWatchTogetherSession } from "./useWatchTogetherSession";

const listeners = new Map<string, Set<(data?: { reason: string }) => void>>();
let connected = false;
const send = vi.fn();
const connect = vi.fn();

vi.mock("../../services/watch-sync", () => ({
  watchSync: {
    get isConnected() { return connected; },
    connect: (...args: unknown[]) => connect(...args),
    send: (...args: unknown[]) => send(...args),
    on: (event: string, callback: (data?: { reason: string }) => void) => {
      const callbacks = listeners.get(event) ?? new Set();
      callbacks.add(callback);
      listeners.set(event, callbacks);
      return () => callbacks.delete(callback);
    },
  },
}));
vi.mock("../useAuth", () => ({ useAuth: () => ({ authToken: "token" }) }));
vi.mock("../../services/plex-api", () => ({
  getPlexUser: () => Promise.resolve({ username: "tester", thumb: "" }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useWatchTogetherSession invite join", () => {
  beforeEach(() => {
    connected = false;
    listeners.clear();
    send.mockClear();
    connect.mockClear();
  });

  it("waits for authentication before joining the session", async () => {
    const { result } = renderHook(
      () => useWatchTogetherSession("session-1", false, "ws://relay.test"),
      { wrapper },
    );
    await waitFor(() => expect(connect).toHaveBeenCalledOnce());
    await act(async () => {
      listeners.get("connected")?.forEach((callback) => callback());
      await Promise.resolve();
    });
    expect(send).not.toHaveBeenCalledWith({ type: "join_session", session_id: "session-1" });

    connected = true;
    act(() => { listeners.get("auth_ok")?.forEach((callback) => callback()); });
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: "join_session", session_id: "session-1" });
      expect(result.current.syncStatus).toBe("synced");
    });
  });

  it("cleans up both auth listeners after an auth error", async () => {
    const { result } = renderHook(
      () => useWatchTogetherSession("session-1", false, "ws://relay.test"),
      { wrapper },
    );
    await waitFor(() => expect(connect).toHaveBeenCalledOnce());
    await act(async () => {
      listeners.get("auth_error")?.forEach((callback) => callback({ reason: "rejected" }));
      await Promise.resolve();
    });
    expect(listeners.get("auth_ok")?.size).toBe(0);
    expect(listeners.get("auth_error")?.size).toBe(0);
    expect(result.current.syncStatus).toBe("disconnected");
    expect(send).not.toHaveBeenCalledWith({ type: "join_session", session_id: "session-1" });
  });
});
