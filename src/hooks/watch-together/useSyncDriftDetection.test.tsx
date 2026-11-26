import { act, renderHook } from "@testing-library/react";
import { useSyncDriftDetection } from "./useSyncDriftDetection";
import type { UsePlayerResult } from "../usePlayer";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());
const player = (currentTime = 0) => ({ currentTime, isPlaying: true, isLoading: false, isBuffering: false, seek: vi.fn() }) as unknown as UsePlayerResult;
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

it("corrects only a drifting guest, leaving the host and aligned viewer alone", () => {
  const host = player(), guest = player(), aligned = player(12);
  const anchor = { current: { time: 10, localTimestamp: 0 } };
  const status = vi.fn();
  const remote = { current: false };
  const { result } = renderHook(() => useSyncDriftDetection(guest, true, status, remote, anchor, false));
  renderHook(() => useSyncDriftDetection(host, true, status, remote, anchor, true));
  renderHook(() => useSyncDriftDetection(aligned, true, status, remote, anchor, false));
  advance(2000);
  expect(guest.seek).toHaveBeenCalledWith(12);
  expect(host.seek).not.toHaveBeenCalled();
  expect(aligned.seek).not.toHaveBeenCalled();
  expect(result.current.resyncing).toBe(true);
  advance(1500);
  expect(result.current.resyncing).toBe(false);
  expect(status).not.toHaveBeenCalled();
});

it("shows repeated corrections within 30 seconds and clears after recovery", () => {
  const p = player();
  const anchor = { current: { time: 10, localTimestamp: 0 } };
  const remote = { current: false };
  const status = vi.fn();
  const { result, rerender, unmount } = renderHook(({ active }) => useSyncDriftDetection(p, active, status, remote, anchor), { initialProps: { active: true } });
  advance(4000);
  expect(result.current.struggling).toBe(false);
  advance(2000);
  expect(result.current.struggling).toBe(true);
  for (let time = 8000; time <= 38000; time += 2000) {
    p.currentTime = 10 + time / 1000;
    rerender({ active: true });
    advance(2000);
  }
  expect(result.current.struggling).toBe(false);
  rerender({ active: false });
  expect(result.current.resyncing).toBe(false);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not seek while loading or buffering and uses a strict two-second threshold", () => {
  const p = player(10);
  const anchor = { current: { time: 10, localTimestamp: 0 } };
  renderHook(() => useSyncDriftDetection(p, true, vi.fn(), { current: false }, anchor));
  advance(2000);
  expect(p.seek).not.toHaveBeenCalled();
  p.isBuffering = true;
  advance(2000);
  expect(p.seek).not.toHaveBeenCalled();
});
