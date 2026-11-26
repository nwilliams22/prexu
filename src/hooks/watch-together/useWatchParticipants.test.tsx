import { act, renderHook } from "@testing-library/react";
import { useWatchParticipants } from "./useWatchParticipants";
const { listeners } = vi.hoisted(() => ({ listeners: new Map<string, (data: unknown) => void>() }));
vi.mock("../../services/watch-sync", () => ({ parseParticipant: vi.fn(), watchSync: {
  on: (event: string, callback: (data: unknown) => void) => { listeners.set(event, callback); return () => listeners.delete(event); },
} }));
it("keeps reconnecting guests in the authoritative roster and removes invitees", () => {
  const { result, unmount } = renderHook(() => useWatchParticipants(true, "room", vi.fn()));
  const guest = { plex_username: "Guest", plex_thumb: "", is_host: false, state: "reconnecting" };
  const snapshot = { session_id: "room", participants: [guest, { ...guest, plex_username: "Invitee", state: "invited" }] };
  act(() => listeners.get("session_state")?.(snapshot));
  expect(result.current.participants).toEqual([{ plexUsername: "Guest", plexThumb: "", isHost: false, state: "reconnecting" }]);
  act(() => listeners.get("session_state")?.({ ...snapshot, session_id: "other", participants: [] }));
  expect(result.current.participants).toHaveLength(1);
  act(() => listeners.get("session_state")?.({ ...snapshot, participants: [{ ...guest, state: "ready" }] }));
  expect(result.current.participants[0].state).toBe("ready");
  unmount();
  expect(listeners.size).toBe(0);
});
