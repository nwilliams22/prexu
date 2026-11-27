import { act, renderHook } from "@testing-library/react";
import { useRemoteMediaSwitch } from "./useRemoteMediaSwitch";
import type { UsePlayerResult } from "../usePlayer";
const { send, navigate } = vi.hoisted(() => ({ send: vi.fn(), navigate: vi.fn() }));
vi.mock("../../services/watch-sync", () => ({ watchSync: { send, on: () => () => {} } }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
beforeEach(() => vi.clearAllMocks());
it("refuses guest item changes even if called directly", () => {
  const { result } = renderHook(() => useRemoteMediaSwitch({ duration: 0, subscribeToEof: () => () => {} } as unknown as UsePlayerResult, true, false, "room"));
  act(() => result.current.loadNextEpisode("18", "Episode"));
  expect(send).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});
it("broadcasts host item changes and preserves session navigation", () => {
  const { result } = renderHook(() => useRemoteMediaSwitch({ duration: 0, subscribeToEof: () => () => {} } as unknown as UsePlayerResult, true, true, "room"));
  act(() => result.current.loadNextEpisode("18", "Episode"));
  expect(send).toHaveBeenCalledWith({ type: "new_media", media_rating_key: "18", media_title: "Episode", media_type: "episode" });
  expect(navigate).toHaveBeenCalledWith("/play/18?session=room&host=true", { replace: true });
});

it("uses EOF rather than a paused position near the end", () => {
  let eof: () => void = () => {};
  const unsubscribe = vi.fn();
  const player = { duration: 60, currentTime: 59.8, isPlaying: false,
    subscribeToEof: (handler: () => void) => { eof = handler; return unsubscribe; },
  } as unknown as UsePlayerResult;
  const { result, unmount } = renderHook(() => useRemoteMediaSwitch(player, true, true, "room"));
  expect(result.current.showNextEpisodePrompt).toBe(false);
  act(() => eof());
  expect(result.current.showNextEpisodePrompt).toBe(true);
  act(() => result.current.loadNextEpisode("19", "Second episode"));
  expect(result.current.showNextEpisodePrompt).toBe(false);
  act(() => eof());
  expect(result.current.showNextEpisodePrompt).toBe(true);
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it.each([[true, false], [false, true]])("does not subscribe to EOF outside a hosted session (%s, %s)", (inSession, host) => {
  const subscribeToEof = vi.fn();
  renderHook(() => useRemoteMediaSwitch({ subscribeToEof } as unknown as UsePlayerResult, inSession, host, "room"));
  expect(subscribeToEof).not.toHaveBeenCalled();
});
