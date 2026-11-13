import { describe, expect, it, vi } from "vitest";
import { playQueueItem } from "./player-queue-navigation";

describe("queue navigation", () => {
  it("restarts a paused duplicate instead of waiting for a rating-key effect", () => {
    const calls: string[] = [];
    const replace = vi.fn();
    playQueueItem("2", "2", {
      isPlaying: false,
      seek: (time) => calls.push(`seek:${time}`),
      togglePlay: () => calls.push("play"),
    }, replace);
    expect(calls).toEqual(["seek:0", "play"]);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not pause a duplicate selected during playback", () => {
    const player = { isPlaying: true, seek: vi.fn(), togglePlay: vi.fn() };
    playQueueItem("2", "2", player, vi.fn());
    expect(player.seek).toHaveBeenCalledWith(0);
    expect(player.togglePlay).not.toHaveBeenCalled();
  });

  it("loads a different item through the existing session path", () => {
    const player = { isPlaying: false, seek: vi.fn(), togglePlay: vi.fn() };
    const replace = vi.fn();
    playQueueItem("3", "2", player, replace);
    expect(replace).toHaveBeenCalledWith("3");
    expect(player.seek).not.toHaveBeenCalled();
    expect(player.togglePlay).not.toHaveBeenCalled();
  });
});
