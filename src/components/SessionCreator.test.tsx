import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SessionCreator from "./SessionCreator";

const { listeners, send, navigate } = vi.hoisted(() => ({
  listeners: new Map<string, (data: Record<string, unknown>) => void>(),
  send: vi.fn(), navigate: vi.fn(),
}));
vi.mock("react-router-dom", async (original) => ({ ...await original<typeof import("react-router-dom")>(), useNavigate: () => navigate }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ authToken: "test", server: { uri: "http://qa.test" } }) }));
vi.mock("../services/plex-api", () => ({
  getPlexUser: async () => ({ username: "host", thumb: "" }),
  getPlexFriends: async () => [{ id: 1, username: "guest", friendlyName: "Guest", thumb: "" }],
}));
vi.mock("../services/storage", () => ({ getRelayUrl: async () => "ws://relay.test" }));
vi.mock("../services/watch-sync", () => ({ watchSync: {
  isConnected: true, send,
  on: (event: string, fn: (data: Record<string, unknown>) => void) => {
    listeners.set(event, fn); return () => listeners.delete(event);
  },
} }));
it("creates a v2 lobby and sends invitations before mounting its player", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><SessionCreator ratingKey="2" title="QA movie" mediaType="movie" onClose={() => {}} /></MemoryRouter>);
  await user.click(await screen.findByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Start Session" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "create_session", protocol_version: 2 })));
  const id = send.mock.calls[0][0].session_id;
  act(() => listeners.get("session_created")?.({ session_id: "other" }));
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => listeners.get("session_created")?.({ session_id: id }));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "invite", target_username: "guest", session_id: id }));
  expect(navigate).toHaveBeenCalledWith(`/play/2?session=${id}&host=true`);
  expect(listeners.size).toBe(0);
  expect(send.mock.calls.some(([message]) => ["ready", "play", "start_now"].includes(message.type))).toBe(false);
});
