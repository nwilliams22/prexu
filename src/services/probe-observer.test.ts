import { afterEach, describe, expect, it, vi } from "vitest";
import { observeProbe, observeProbePlay, type ProbeSnapshot } from "./probe-observer";

const absent: ProbeSnapshot = {
  initialized: false, idle: true, fixtureMatches: false,
  positionMs: null, paused: null, audioTrack: null, subtitleTrack: null,
};
const playing = (positionMs: number): ProbeSnapshot => ({
  ...absent, initialized: true, idle: false, fixtureMatches: true, paused: false, positionMs,
});

afterEach(() => vi.useRealTimers());

describe("probe native observations", () => {
  it("does not dispatch play while the previous handle is present", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const play = vi.fn();
    const read = vi.fn().mockResolvedValue(playing(200));
    const result = observeProbePlay(controller.signal, read, play);
    const rejection = expect(result).rejects.toMatchObject({ code: "step_timeout" });
    await vi.advanceTimersByTimeAsync(400);
    expect(play).not.toHaveBeenCalled();
    controller.abort();
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requires fresh advancing time and rejects frozen/wrong-fixture samples", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const play = vi.fn();
    const read = vi.fn().mockResolvedValueOnce(absent)
      .mockResolvedValueOnce(playing(100))
      .mockResolvedValueOnce(playing(100))
      .mockResolvedValueOnce({ ...playing(200), fixtureMatches: false })
      .mockResolvedValueOnce(playing(300))
      .mockResolvedValueOnce(playing(310));
    const completed = vi.fn();
    const result = observeProbePlay(controller.signal, read, play).then(completed);
    await vi.advanceTimersByTimeAsync(300);
    expect(play).toHaveBeenCalledTimes(1);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(completed).toHaveBeenCalledWith({ loaded: true, positionMs: 310 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a hung sample and ignores its late reply", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let reply!: (value: boolean) => void;
    const read = vi.fn(() => new Promise<boolean>((resolve) => { reply = resolve; }));
    const accepts = vi.fn(() => true);
    const result = observeProbe(controller.signal, read, accepts);
    const rejection = expect(result).rejects.toMatchObject({ code: "step_timeout" });
    controller.abort();
    await rejection;
    reply(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(accepts).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never dispatches play after cancellation of the absent-handle read", async () => {
    const controller = new AbortController();
    let reply!: (value: ProbeSnapshot) => void;
    const read = () => new Promise<ProbeSnapshot>((resolve) => { reply = resolve; });
    const play = vi.fn();
    const result = observeProbePlay(controller.signal, read, play);
    const rejection = expect(result).rejects.toMatchObject({ code: "step_timeout" });
    reply(absent);
    controller.abort();
    await rejection;
    expect(play).not.toHaveBeenCalled();
  });

  it("propagates read failures instead of converting them to idle", async () => {
    await expect(observeProbe(new AbortController().signal,
      async () => { throw new Error("unavailable"); }, () => true)).rejects.toThrow("unavailable");
  });
});
