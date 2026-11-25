import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useHlsLoader } from "./useHlsLoader";

const state = vi.hoisted(() => ({ manifest: undefined as undefined | (() => void) }));
vi.mock("hls.js", () => ({ default: class {
  static Events = { MANIFEST_PARSED: "manifest", ERROR: "error" };
  loadSource() {}
  attachMedia() {}
  on(event: string, callback: () => void) { if (event === "manifest") state.manifest = callback; }
  destroy() {}
} }));
vi.mock("../../services/plex-playback", () => ({
  buildTranscodeUrl: vi.fn().mockResolvedValue("https://server/stream.m3u8"),
  buildHlsConfig: vi.fn().mockReturnValue({}),
}));
beforeEach(() => { state.manifest = undefined; });
it.each([true, false])("track rebuild preserves paused=%s", async (paused) => {
  const video = document.createElement("video");
  Object.defineProperty(video, "paused", { value: paused });
  const play = vi.spyOn(video, "play").mockResolvedValue();
  const { result } = renderHook(() => useHlsLoader());
  await act(() => result.current.rebuildHls({
    serverUri: "https://server", serverToken: "test", ratingKey: "1", video,
    startTime: 0, quality: "original", subtitleSize: 100, audioBoost: 1, onError: vi.fn(),
  }));
  act(() => state.manifest!());
  expect(play).toHaveBeenCalledTimes(paused ? 0 : 1);
});
