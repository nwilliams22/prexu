import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useWatchTogetherSession } from "./useWatchTogetherSession";

const listeners = new Map<string, Set<(data?: Record<string, unknown>) => void>>();
let connected = false;
const send = vi.fn();
const connect = vi.fn();

vi.mock("../../services/watch-sync", () => ({
  watchSync: {
    get isConnected() { return connected; },
    connect: (...args: unknown[]) => connect(...args),
    send: (...args: unknown[]) => send(...args),
    on: (event: string, callback: (data?: Record<string, unknown>) => void) => {
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
    act(() => { listeners.get("auth_ok")?.forEach((callback) => callback({ plex_username: "tester" })); });
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
    expect(listeners.get("auth_ok")?.size).toBe(1);
    expect(listeners.get("auth_error")?.size).toBe(0);
    expect(result.current.syncStatus).toBe("disconnected");
    expect(send).not.toHaveBeenCalledWith({ type: "join_session", session_id: "session-1" });
  });
});

const snapshot = {
  session_id: "session-1", phase: "lobby", host_away: false,
  media_title: "QA movie", media_rating_key: "2", media_type: "movie",
  participants: [{ plex_username: "tester", plex_thumb: "", is_host: true, state: "ready" },
    { plex_username: "guest", plex_thumb: "", is_host: false, state: "invited" }],
};
function emit(event: string, data: Record<string, unknown>) {
  act(() => listeners.get(event)?.forEach(callback => callback(data)));
}

describe("authoritative lobby", () => {
  beforeEach(() => { connected = true; listeners.clear(); send.mockClear(); });
  it("recovers the creator snapshot and never starts from a locally ready roster", () => {
    const { result } = renderHook(() => useWatchTogetherSession("session-1", true), { wrapper });
    expect(send).toHaveBeenCalledWith({ type: "join_session", session_id: "session-1" });
    emit("session_state", { ...snapshot, session_id: "other" });
    expect(result.current.lobby).toBeNull();
    emit("session_state", snapshot);
    expect(result.current.lobby?.participants[1].state).toBe("invited");
    emit("session_state", { ...snapshot, participants: snapshot.participants.map(p => ({ ...p, state: "ready" })) });
    expect(result.current.lobby?.phase).toBe("lobby");
    expect(send).not.toHaveBeenCalledWith({ type: "start_now" });
    act(() => result.current.startNow());
    expect(send).toHaveBeenCalledWith({ type: "start_now" });
    expect(result.current.lobby?.phase).toBe("lobby");
    emit("session_state", { ...snapshot, phase: "playback" });
    expect(result.current.lobby?.phase).toBe("playback");
  });
  it("resends and removes only for a connected host", () => {
    const { result } = renderHook(() => useWatchTogetherSession("session-1", true), { wrapper });
    emit("session_state", snapshot);
    act(() => { result.current.resendInvite("guest"); result.current.removeParticipant("guest"); });
    expect(send).toHaveBeenCalledWith({ type: "invite", session_id: "session-1", target_username: "guest" });
    expect(send).toHaveBeenCalledWith({ type: "remove_participant", plex_username: "guest" });
    emit("session_state", { ...snapshot, host_away: true });
    send.mockClear();
    act(() => { result.current.startNow(); result.current.removeParticipant("guest"); result.current.resendInvite("guest"); });
    expect(send).not.toHaveBeenCalled();
  });
  it("rejoins after authentication and stops only when this client is removed", async () => {
    const { result } = renderHook(() => useWatchTogetherSession("session-1", false), { wrapper });
    await act(async () => { await Promise.resolve(); });
    send.mockClear();
    emit("auth_ok", { plex_username: "tester" });
    expect(send).toHaveBeenCalledWith({ type: "join_session", session_id: "session-1" });
    emit("participant_removed", { plex_username: "guest" });
    expect(result.current.sessionEnded).toBe(false);
    emit("participant_removed", { plex_username: "tester" });
    expect(result.current.sessionEnded).toBe(true);
  });
});
