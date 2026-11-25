import { act, renderHook } from "@testing-library/react";
import { useRemoteMediaSwitch } from "./useRemoteMediaSwitch";
import type { UsePlayerResult } from "../usePlayer";
const { send, navigate } = vi.hoisted(() => ({ send: vi.fn(), navigate: vi.fn() }));
vi.mock("../../services/watch-sync", () => ({ watchSync: { send, on: () => () => {} } }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
beforeEach(() => vi.clearAllMocks());
it("refuses guest item changes even if called directly", () => {
  const { result } = renderHook(() => useRemoteMediaSwitch({ duration: 0 } as UsePlayerResult, true, false, "room"));
  act(() => result.current.loadNextEpisode("18", "Episode"));
  expect(send).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});
it("broadcasts host item changes and preserves session navigation", () => {
  const { result } = renderHook(() => useRemoteMediaSwitch({ duration: 0 } as UsePlayerResult, true, true, "room"));
  act(() => result.current.loadNextEpisode("18", "Episode"));
  expect(send).toHaveBeenCalledWith({ type: "new_media", media_rating_key: "18", media_title: "Episode", media_type: "episode" });
  expect(navigate).toHaveBeenCalledWith("/play/18?session=room&host=true", { replace: true });
});
