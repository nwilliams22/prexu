import { afterEach, expect, it, vi } from "vitest";
import type { UsePlayerResult } from "../hooks/usePlayer";
import { createLiveProbeAdapter, probeLive, type ProbeHost } from "./probe-live";
import type { ProbeSnapshot } from "./probe-observer";

const snapshot: ProbeSnapshot = { initialized: true, idle: false, fixtureMatches: true,
  positionMs: 2000, paused: true, audioTrack: 2, subtitleTrack: 0 };
function fixture() {
  const player = { engine: "native", playbackError: null, seek: vi.fn(), togglePlay: vi.fn(),
    audioTracks: [{ id: 101 }, { id: 205 }], subtitleTracks: [{ id: 303 }],
    selectAudioTrack: vi.fn(), selectSubtitleTrack: vi.fn(), setVolume: vi.fn(), volume: .7,
  } as unknown as UsePlayerResult;
  probeLive.player = { player, stop: vi.fn(async () => {}), toggleFullscreen: vi.fn(),
    togglePopout: vi.fn(), minimize: vi.fn(), restore: vi.fn(), mini: false, popout: false,
    supportsMini: true, supportsPopout: false };
  const host: ProbeHost = { play: vi.fn(), stop: vi.fn(), hasSession: () => true,
    route: () => "/", navigate: vi.fn(), snapshot: vi.fn(async () => snapshot),
    windowMinimize: vi.fn(async () => {}), windowRestore: vi.fn(async () => {}),
    windowMinimized: async () => false };
  return { player, host, adapter: createLiveProbeAdapter(host) };
}
afterEach(() => { probeLive.player = null; vi.useRealTimers(); });
it("maps native track ordinals to actual Plex stream IDs through UI handlers", async () => {
  const { player, adapter } = fixture();
  const signal = new AbortController().signal;
  await expect(adapter.execute({ id: "a", action: "selectAudio", args: { trackId: 2 }, timeoutMs: 5000 }, signal))
    .resolves.toEqual({ trackId: 2 });
  expect(player.selectAudioTrack).toHaveBeenCalledWith(205);
  await adapter.execute({ id: "s", action: "selectSubtitle", args: { trackId: 0 }, timeoutMs: 5000 }, signal);
  expect(player.selectSubtitleTrack).toHaveBeenCalledWith(null);
});
it("does not pass a seek from frontend state when native state differs", async () => {
  vi.useFakeTimers();
  const { player, adapter } = fixture();
  const controller = new AbortController();
  const result = adapter.execute({ id: "s", action: "seek", args: { positionMs: 8000, toleranceMs: 100 }, timeoutMs: 5000 }, controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ code: "step_timeout" });
  await vi.advanceTimersByTimeAsync(300);
  expect(player.seek).toHaveBeenCalledWith(8);
  controller.abort();
  await rejected;
});
it("requires session clearance and absent native handle after stop", async () => {
  vi.useFakeTimers();
  const { adapter } = fixture();
  const controller = new AbortController();
  const result = adapter.execute({ id: "s", action: "stop", timeoutMs: 5000 }, controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ code: "step_timeout" });
  await vi.advanceTimersByTimeAsync(300);
  expect(probeLive.player!.stop).toHaveBeenCalledOnce();
  controller.abort();
  await rejected;
});
it("fails unsupported popout explicitly without dispatch", async () => {
  const { adapter } = fixture();
  await expect(adapter.execute({ id: "p", action: "popout", args: { enabled: true }, timeoutMs: 5000 }, new AbortController().signal))
    .rejects.toMatchObject({ code: "unsupported_action" });
  expect(probeLive.player!.togglePopout).not.toHaveBeenCalled();
});
it("does not dispatch after cancellation", async () => {
  const { adapter, player } = fixture();
  const controller = new AbortController(); controller.abort();
  await expect(adapter.execute({ id: "s", action: "seek", args: { positionMs: 2000, toleranceMs: 500 }, timeoutMs: 5000 }, controller.signal))
    .rejects.toMatchObject({ code: "step_timeout" });
  expect(player.seek).not.toHaveBeenCalled();
});
