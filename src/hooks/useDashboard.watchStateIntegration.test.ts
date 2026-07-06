/**
 * End-to-end regression coverage for prexu-dqfc: a mounted Dashboard's
 * "Resume from X:XX" popover kept showing the PRE-session viewOffset after a
 * real stop, even with the ratingKey+offset payload (PR #66/#72), the
 * cache-invalidators optimistic patch, and the offset-floor guard all in
 * place.
 *
 * Unlike useDashboard.test.ts (which mocks api-cache and calls
 * registerOffsetFloor directly, in isolation) and cache-invalidators.test.ts
 * (which never mounts useDashboard), this file wires the REAL api-cache
 * store and the REAL initializeCacheInvalidators() listener together with a
 * REAL, mounted useDashboard() and a REAL emitWatchStateChanged() dispatch —
 * the actual runtime wiring a hardware repro exercises. Root cause: with
 * useDashboard's own on-event listener firing its deck refetch at T+0 (no
 * delay) and the offset floor's fixed window measured from the SAME
 * instant, a real Plex Media Server onDeck-rebuild response landing after
 * that window elapsed cemented the stale pre-stop offset into both React
 * state and the 60-minute deck cache, with no other invalidation left
 * pending to ever correct it. The fix delays useDashboard's own refetch by
 * DECK_INVALIDATION_DELAY_MS (aligning it with the same ingestion buffer
 * cache-invalidators.ts's own backstop invalidation already trusted) and
 * widens the floor window to cover that delay plus the original
 * network-latency margin.
 *
 * Uses fake timers (matching cache-invalidators.test.ts's own convention
 * for DECK_INVALIDATION_DELAY_MS timing tests) so multi-second real-world
 * latencies are simulated instantly rather than the suite actually sleeping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDashboard } from "./useDashboard";
import {
  initializeCacheInvalidators,
  __clearOffsetFloorsForTests,
  DECK_INVALIDATION_DELAY_MS,
  OFFSET_FLOOR_WINDOW_MS,
} from "../services/cache-invalidators";
import { emitWatchStateChanged } from "../services/watch-state-events";
import { cacheClear, cacheSet, cacheGet } from "../services/api-cache";

const stableServer = { uri: "https://plex.test", accessToken: "token" };
vi.mock("./useAuth", () => ({ useAuth: () => ({ server: stableServer }) }));
vi.mock("./useLibrary", () => ({
  useLibrary: () => ({
    sections: [{ key: "1", title: "Movies", type: "movie", updatedAt: 0 }],
    isLoading: false,
    error: null,
  }),
}));
vi.mock("./useServerActivity", () => ({ useCompletionCounter: () => 0 }));

const mockGetOnDeck = vi.fn();
vi.mock("../services/plex-library", () => ({
  getRecentlyAddedBySection: vi.fn(() => Promise.resolve([])),
  getOnDeck: (...args: unknown[]) => mockGetOnDeck(...args),
}));

const DECK_KEY = "dashboard:https://plex.test:deck";
const RATING_KEY = "555";
const PRE_STOP_OFFSET = 372_000; // 6:12 -- the value from the PRIOR session
const POST_STOP_OFFSET = 470_000; // 7:50 -- what the player just reported

async function mountAndSettle() {
  const hook = renderHook(() => useDashboard());
  // Initial mount fetches are same-tick-resolved mocks; flush microtasks.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return hook;
}

describe("useDashboard <-> cache-invalidators real integration (prexu-dqfc)", () => {
  beforeEach(() => {
    cacheClear();
    __clearOffsetFloorsForTests();
    mockGetOnDeck.mockReset();
    // Real module-level listener, exactly as main.tsx wires it at app boot —
    // NOT the same as calling registerOffsetFloor/applyOffsetFloors
    // directly, which is all the other test files exercise.
    initializeCacheInvalidators();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    vi.useRealTimers();
  });

  it("does not refetch the deck synchronously when the stop event fires — the refetch is delayed", async () => {
    cacheSet(DECK_KEY, [{ ratingKey: RATING_KEY, title: "Nosferatu", type: "movie", viewOffset: PRE_STOP_OFFSET }], 60 * 60 * 1000);
    mockGetOnDeck.mockResolvedValue([{ ratingKey: RATING_KEY, title: "Nosferatu", type: "movie", viewOffset: POST_STOP_OFFSET }]);

    const { result } = await mountAndSettle();
    expect(result.current.loading.deck).toBe(false);

    act(() => {
      emitWatchStateChanged(RATING_KEY, { viewOffsetMs: POST_STOP_OFFSET });
    });

    // getOnDeck should NOT have been called again yet — the refresh is
    // scheduled DECK_INVALIDATION_DELAY_MS out, not fired at T+0.
    expect(mockGetOnDeck).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DECK_INVALIDATION_DELAY_MS);
    });

    expect(result.current.onDeck[0]?.viewOffset).toBe(POST_STOP_OFFSET);
  });

  it("recovers the correct offset even when the live getOnDeck response is still stale at ~6s real-world latency from the stop event (previously landed after the flat 5s floor had already expired)", async () => {
    cacheSet(DECK_KEY, [{ ratingKey: RATING_KEY, title: "Nosferatu", type: "movie", viewOffset: PRE_STOP_OFFSET }], 60 * 60 * 1000);

    // PMS hasn't ingested the write yet by the time this resolves — the
    // response still carries the pre-stop offset. Total latency from the
    // event is DECK_INVALIDATION_DELAY_MS (scheduling delay) + 4200ms
    // (simulated network/ingestion time) = ~6s, which exceeded the OLD flat
    // 5000ms floor (measured from an OLD T+0 refetch) but fits comfortably
    // inside the fix's widened OFFSET_FLOOR_WINDOW_MS.
    mockGetOnDeck.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve([{ ratingKey: RATING_KEY, title: "Nosferatu", type: "movie", viewOffset: PRE_STOP_OFFSET }]);
          }, 4200);
        }),
    );

    const { result } = await mountAndSettle();
    expect(result.current.onDeck[0]?.viewOffset).toBe(PRE_STOP_OFFSET);

    act(() => {
      emitWatchStateChanged(RATING_KEY, { viewOffsetMs: POST_STOP_OFFSET });
    });

    // Advance in two steps -- the scheduling delay first (which starts the
    // fetch and, inside it, arms the mock's OWN nested setTimeout), then the
    // simulated network/ingestion latency -- so both timers are live before
    // either is advanced past.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DECK_INVALIDATION_DELAY_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
    });

    expect(result.current.onDeck[0]?.viewOffset).toBe(POST_STOP_OFFSET);
    // The corrected value must also have been written back to the cache —
    // otherwise a later remount (cache hit, no refetch) would re-show the
    // stale value despite the in-memory state being briefly correct.
    expect(
      (cacheGet(DECK_KEY) as { viewOffset: number }[] | null)?.[0]?.viewOffset,
    ).toBe(POST_STOP_OFFSET);
  });

  it("still shows the stale offset if PMS takes longer than even the widened floor window (documents the residual, narrowed-not-closed race)", async () => {
    cacheSet(DECK_KEY, [{ ratingKey: RATING_KEY, title: "Nosferatu", type: "movie", viewOffset: PRE_STOP_OFFSET }], 60 * 60 * 1000);
    mockGetOnDeck.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve([{ ratingKey: RATING_KEY, title: "Nosferatu", type: "movie", viewOffset: PRE_STOP_OFFSET }]);
          }, OFFSET_FLOOR_WINDOW_MS); // response lands exactly as the floor expires
        }),
    );

    const { result } = await mountAndSettle();

    act(() => {
      emitWatchStateChanged(RATING_KEY, { viewOffsetMs: POST_STOP_OFFSET });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DECK_INVALIDATION_DELAY_MS + OFFSET_FLOOR_WINDOW_MS + 100);
    });

    // Documented residual limitation (matches PR #72's own "narrows, can't
    // close" framing) — an extreme PMS delay beyond the widened window can
    // still show stale momentarily. Not the bug this PR fixes; recorded so
    // a future change to the constants can see exactly what's covered.
    expect(result.current.onDeck[0]?.viewOffset).toBe(PRE_STOP_OFFSET);
  });

  it("collapses a rapid double stop-event into a single delayed refresh instead of piling up timers", async () => {
    cacheSet(DECK_KEY, [{ ratingKey: RATING_KEY, title: "Nosferatu", type: "movie", viewOffset: PRE_STOP_OFFSET }], 60 * 60 * 1000);
    mockGetOnDeck.mockResolvedValue([{ ratingKey: RATING_KEY, title: "Nosferatu", type: "movie", viewOffset: POST_STOP_OFFSET }]);

    const { result } = await mountAndSettle();

    act(() => {
      emitWatchStateChanged(RATING_KEY, { viewOffsetMs: 400_000 });
      emitWatchStateChanged(RATING_KEY, { viewOffsetMs: POST_STOP_OFFSET });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DECK_INVALIDATION_DELAY_MS);
    });

    expect(result.current.onDeck[0]?.viewOffset).toBe(POST_STOP_OFFSET);
    // Only one refetch should have been triggered by the pair of events.
    expect(mockGetOnDeck).toHaveBeenCalledTimes(1);
  });

  it("clears the pending deck-refresh timer on unmount so no post-unmount setState occurs", async () => {
    cacheSet(DECK_KEY, [{ ratingKey: RATING_KEY, title: "Nosferatu", type: "movie", viewOffset: PRE_STOP_OFFSET }], 60 * 60 * 1000);
    mockGetOnDeck.mockResolvedValue([{ ratingKey: RATING_KEY, title: "Nosferatu", type: "movie", viewOffset: POST_STOP_OFFSET }]);

    const { result, unmount } = await mountAndSettle();
    expect(result.current.loading.deck).toBe(false);

    act(() => {
      emitWatchStateChanged(RATING_KEY, { viewOffsetMs: POST_STOP_OFFSET });
    });

    unmount();

    // If the pending timer weren't cleared on unmount, refresh("deck")
    // would fire post-unmount and React would warn/crash on a setState
    // targeting an unmounted component. Any such warning fails the test
    // via the project's console-error-as-failure setup; the assertion here
    // is just that the getOnDeck call the (correctly-cleared) timer would
    // have triggered never happens.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DECK_INVALIDATION_DELAY_MS + 200);
    });

    expect(mockGetOnDeck).not.toHaveBeenCalled();
  });
});
