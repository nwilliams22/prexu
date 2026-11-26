import { act, renderHook } from "@testing-library/react";
import { useRemotePlayback } from "./useRemotePlayback";
import type { UsePlayerResult } from "../usePlayer";

const { listeners, send, toast } = vi.hoisted(() => ({
  listeners: new Map<string, (data: unknown) => void>(), send: vi.fn(), toast: vi.fn(),
}));
vi.mock("../../services/watch-sync", () => ({ watchSync: {
  send, on: (event: string, callback: (data: unknown) => void) => {
    listeners.set(event, callback);
    return () => listeners.delete(event);
  },
} }));
vi.mock("../useToast", () => ({ useToast: () => ({ toast }) }));
const status = vi.fn();
const makePlayer = (overrides = {}) => ({
  isPrepared: true, isPlaying: true, currentTime: 20, duration: 100, isLoading: false,
  isBuffering: false, seek: vi.fn(), togglePlay: vi.fn(), ...overrides,
}) as unknown as UsePlayerResult;
const emit = (event: string, data: unknown) => act(() => listeners.get(event)?.(data));

beforeEach(() => { listeners.clear(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(10000); });
afterEach(() => vi.useRealTimers());

it("does not broadcast pause/play on mount or buffering transitions", () => {
  const p = makePlayer();
  const { rerender } = renderHook(({ player }) => useRemotePlayback(player, true, status, "room"), { initialProps: { player: p } });
  rerender({ player: { ...p, isPlaying: false, isBuffering: true } });
  rerender({ player: { ...p, isPlaying: true, isBuffering: false } });
  expect(send.mock.calls.map(([message]) => message.type)).toEqual(["ready", "buffering", "ready"]);
});
it("broadcasts guest user intent and resets the local drift target", () => {
  const p = makePlayer();
  const { result } = renderHook(() => useRemotePlayback(p, true, status, "room"));
  act(() => result.current.syncTogglePlay());
  expect(send).toHaveBeenCalledWith({ type: "pause", current_time: 20, timestamp: 10000 });
  act(() => result.current.syncSeek(45));
  expect(send).toHaveBeenCalledWith({ type: "seek", current_time: 45, timestamp: 10000 });
  expect(p.seek).toHaveBeenCalledWith(45);
});
it("applies remote controls with attribution and no echo", () => {
  const p = makePlayer();
  renderHook(() => useRemotePlayback(p, true, status, "room"));
  send.mockClear();
  emit("remote_pause", { current_time: 30, timestamp: 9000, from_user: "Guest" });
  expect(p.seek).toHaveBeenCalledWith(30);
  expect(p.togglePlay).toHaveBeenCalledOnce();
  expect(toast).toHaveBeenCalledWith("Guest paused");
  emit("remote_seek", { current_time: 45, timestamp: 9000, from_user: "Guest" });
  expect(p.seek).toHaveBeenLastCalledWith(46);
  expect(toast).toHaveBeenLastCalledWith("Guest sought to 0:45");
  expect(send).not.toHaveBeenCalled();
});
it("keeps a paused seek exact despite transit time", () => {
  const p = makePlayer({ isPlaying: false });
  const { result } = renderHook(() => useRemotePlayback(p, true, status));
  emit("remote_seek", { current_time: 45, timestamp: 8000, from_user: "Guest" });
  expect(p.seek).toHaveBeenCalledWith(45);
  expect(result.current.lastRemoteSyncRef.current).toBeNull();
});
it("waits for a late joiner to load, then catches up without pausing others", () => {
  const p = makePlayer({ isPlaying: false, isLoading: true, isBuffering: true, duration: 0 });
  const { result, rerender } = renderHook(({ player }) => useRemotePlayback(player, true, status, "room"), { initialProps: { player: p } });
  emit("session_state", { session_id: "room", phase: "playback", playing: true, current_time: 35, timestamp: 10000 });
  expect(result.current.catchingUp).toBe(true);
  expect(p.seek).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(3000));
  rerender({ player: { ...p, isLoading: false, isBuffering: false, duration: 100 } });
  expect(p.seek).toHaveBeenCalledWith(38);
  expect(p.togglePlay).toHaveBeenCalledOnce();
  expect(result.current.catchingUp).toBe(false);
  expect(send.mock.calls.map(([message]) => message.type)).toEqual(["ready"]);
});
it("does not continually seek on roster snapshots and removes subscriptions", () => {
  const p = makePlayer();
  const { unmount } = renderHook(() => useRemotePlayback(p, true, status, "room"));
  const snapshot = { session_id: "room", phase: "playback", playing: true, current_time: 35, timestamp: 10000 };
  emit("session_state", { ...snapshot, session_id: "other" });
  expect(p.seek).not.toHaveBeenCalled();
  emit("session_state", snapshot);
  emit("session_state", snapshot);
  expect(p.seek).toHaveBeenCalledOnce();
  unmount();
  expect(listeners.size).toBe(0);
});

it("holds lobby controls and follows the authoritative start transition", () => {
  const p = makePlayer({ isPlaying: false });
  const { result } = renderHook(() => useRemotePlayback(p, true, status, "room"));
  emit("session_state", { session_id: "room", phase: "lobby", playing: false, current_time: 0, timestamp: 10000 });
  send.mockClear();
  act(() => result.current.syncTogglePlay());
  act(() => result.current.syncSeek(30));
  expect(send).not.toHaveBeenCalled();
  expect(p.togglePlay).not.toHaveBeenCalled();
  emit("session_state", { session_id: "room", phase: "playback", playing: true, current_time: 0, timestamp: 10000 });
  expect(p.togglePlay).toHaveBeenCalledOnce();
});

 it("does not advertise readiness or apply a start until decoder preparation", () => {
  const p = makePlayer({ isPrepared: false, isPlaying: false });
  const { rerender } = renderHook(({ player }) => useRemotePlayback(player, true, status, "room"), { initialProps: { player: p } });
  emit("session_state", { session_id: "room", phase: "playback", playing: true, current_time: 0, timestamp: 10000 });
  expect(send).not.toHaveBeenCalled();
  expect(p.togglePlay).not.toHaveBeenCalled();
  rerender({ player: { ...p, isPrepared: true } });
  expect(send).toHaveBeenCalledWith({ type: "ready", current_time: 20 });
  expect(p.togglePlay).toHaveBeenCalledOnce();
});

it("waits for session membership before reporting readiness and reports again on reconnect", () => {
  const p = makePlayer({ isPlaying: false });
  const { rerender } = renderHook(({ joined }) => useRemotePlayback(p, true, status, "room", joined), { initialProps: { joined: false } });
  expect(send).not.toHaveBeenCalled();
  rerender({ joined: true });
  expect(send).toHaveBeenCalledOnce();
  rerender({ joined: false });
  rerender({ joined: true });
  expect(send).toHaveBeenCalledTimes(2);
});

it("reapplies the authoritative clock after reconnect without a phase change", () => {
  const p = makePlayer();
  renderHook(() => useRemotePlayback(p, true, status, "room"));
  const snapshot = { session_id: "room", phase: "playback", playing: true, current_time: 35, timestamp: 10000 };
  emit("session_state", snapshot);
  emit("disconnected", null);
  emit("session_state", { ...snapshot, current_time: 50 });
  expect(p.seek).toHaveBeenLastCalledWith(50);
  expect(p.seek).toHaveBeenCalledTimes(2);
});

it("pauses in host grace, blocks controls, and resumes from the returned snapshot", () => {
  const p = makePlayer();
  const { result, rerender } = renderHook(({ player }) => useRemotePlayback(player, true, status, "room"), { initialProps: { player: p } });
  const snapshot = { session_id: "room", phase: "playback", playing: true, current_time: 35, timestamp: 10000, host_away: false };
  emit("session_state", snapshot);
  emit("session_state", { ...snapshot, host_away: true, playing: false });
  expect(p.togglePlay).toHaveBeenCalledOnce();
  expect(result.current.lastRemoteSyncRef.current).toBeNull();
  send.mockClear();
  act(() => { result.current.syncSeek(90); result.current.syncTogglePlay(); });
  expect(send).not.toHaveBeenCalled();
  rerender({ player: { ...p, isPlaying: false } });
  emit("session_state", { ...snapshot, current_time: 40 });
  expect(p.seek).toHaveBeenLastCalledWith(40);
  expect(p.togglePlay).toHaveBeenCalledTimes(2);
});

it("rejoins at the host snapshot after its connection returns", () => {
  const p = makePlayer();
  renderHook(() => useRemotePlayback(p, true, status, "room"));
  const snapshot = { session_id: "room", phase: "playback", playing: true, current_time: 35, timestamp: 10000, host_away: false };
  emit("session_state", snapshot);
  emit("disconnected", null);
  emit("session_state", { ...snapshot, current_time: 55 });
  expect(p.seek).toHaveBeenLastCalledWith(55);
  emit("session_destroyed", {});
  expect(toast).toHaveBeenLastCalledWith("Session ended - host left");
});

it("takes periodic clock samples only from the identified host", () => {
  const p = makePlayer();
  const { result } = renderHook(() => useRemotePlayback(p, true, status, "room"));
  emit("session_state", { session_id: "room", phase: "playback", playing: true, current_time: 20, timestamp: 10000, host_away: false, participants: [{ plex_username: "Host", is_host: true }] });
  emit("remote_ready", { from_user: "Guest", current_time: 70 });
  expect(result.current.lastRemoteSyncRef.current?.time).toBe(20);
  emit("remote_ready", { from_user: "Host", current_time: 25 });
  expect(result.current.lastRemoteSyncRef.current?.time).toBe(25);
  expect(p.seek).toHaveBeenCalledOnce();
});

it("publishes the host player position without seeking or broadcasting controls", () => {
  const p = makePlayer();
  renderHook(() => useRemotePlayback(p, true, status, "room", true, true));
  emit("session_state", { session_id: "room", phase: "playback", playing: true, current_time: 20, timestamp: 10000, host_away: false });
  send.mockClear();
  act(() => vi.advanceTimersByTime(2000));
  expect(send.mock.calls).toEqual([[{ type: "ready", current_time: 20 }]]);
});

it("does not toggle twice when host grace controls and snapshots precede engine updates", () => {
  const p = makePlayer();
  const { rerender } = renderHook(({ player }) => useRemotePlayback(player, true, status, "room"), { initialProps: { player: p } });
  const snapshot = { session_id: "room", phase: "playback", playing: true, current_time: 20, timestamp: 10000, host_away: false };
  emit("session_state", snapshot);
  emit("remote_pause", { current_time: 20, timestamp: 10000, from_user: "Host" });
  emit("session_state", { ...snapshot, playing: false, host_away: true });
  expect(p.togglePlay).toHaveBeenCalledTimes(1);
  rerender({ player: { ...p, isPlaying: false } });
  emit("remote_play", { current_time: 20, timestamp: 10000, from_user: "Host" });
  emit("session_state", snapshot);
  expect(p.togglePlay).toHaveBeenCalledTimes(2);
});
