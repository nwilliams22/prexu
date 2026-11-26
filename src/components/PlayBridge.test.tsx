import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import PlayBridge from "./PlayBridge";
const play = vi.fn(), navigate = vi.fn();
let query = new URLSearchParams();
vi.mock("../App", () => ({ LAST_NON_PLAYER_ROUTE_KEY: "test-last-route" }));
vi.mock("../contexts/PlayerContext", () => ({ usePlayerSession: () => ({ play }) }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ server: { uri: "https://qa.test" } }) }));
vi.mock("../services/storage", () => ({ getRelayUrl: async () => "wss://relay.test/ws" }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate, useParams: () => ({ ratingKey: "17" }), useSearchParams: () => [query] }));
beforeEach(() => { play.mockClear(); navigate.mockClear(); });
it.each(["session=AB12CD34&relay=wss://evil.test/ws", "session=malformed", "session=AB12CD34&relay=wss://user:secret@relay.test/ws"])("rejects unsafe playback invite %s without loading media", async (raw) => {
  query = new URLSearchParams(raw);
  render(<PlayBridge />);
  expect(await screen.findByRole("alert")).toHaveTextContent("invalid");
  expect(play).not.toHaveBeenCalled();
});
it("uses only the configured relay when joining a valid session", async () => {
  query = new URLSearchParams("session=AB12CD34");
  render(<PlayBridge />);
  await waitFor(() => expect(play).toHaveBeenCalledWith("17", { offset: undefined, watchTogether: { sessionId: "AB12CD34", isHost: false, relayUrl: "wss://relay.test/ws" } }));
});
