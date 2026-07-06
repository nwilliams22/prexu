import { act, renderHook } from "@testing-library/react";
import {
  useRouteTransitionSpinner,
  PLAYER_EXIT_SPINNER_MS,
} from "./useRouteTransitionSpinner";

vi.mock("../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

describe("useRouteTransitionSpinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not show immediately on initial mount or a regular navigation", () => {
    const { result, rerender } = renderHook(
      ({ pathname }) => useRouteTransitionSpinner(pathname),
      { initialProps: { pathname: "/" } },
    );
    expect(result.current).toBe(false);

    rerender({ pathname: "/library/1" });
    expect(result.current).toBe(false);
  });

  // prexu-xb3h: this hook used to activate a readiness-blind, timer-only
  // overlay for every non-player-route navigation (150ms pre-show delay,
  // 300ms display ceiling). Those timers are scheduled relative to when the
  // PREVIOUS timer callback actually ran, so a congested main thread (e.g.
  // Dashboard's own staged shelf-mounting work) could push both well past
  // their nominal durations — producing a multi-second full-page overlay on
  // an ordinary detail -> dashboard back-navigation, which this route never
  // needs an overlay for (every destination page owns its own skeleton/
  // loading UI). Fixed by removing that branch entirely: regular navigation
  // must NEVER activate the overlay, no matter how long it takes.
  it("never activates for a regular navigation, no matter how much time passes", () => {
    const { result, rerender } = renderHook(
      ({ pathname }) => useRouteTransitionSpinner(pathname),
      { initialProps: { pathname: "/item/123" } },
    );

    rerender({ pathname: "/" });
    expect(result.current).toBe(false);

    // Well past the old 150ms + 300ms window — simulates a congested main
    // thread delaying everything by seconds.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);
  });

  it("never activates across a rapid sequence of regular navigations", () => {
    const { result, rerender } = renderHook(
      ({ pathname }) => useRouteTransitionSpinner(pathname),
      { initialProps: { pathname: "/" } },
    );

    for (const pathname of ["/library/1", "/item/5", "/search", "/"]) {
      rerender({ pathname });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current).toBe(false);
    }
  });

  it("shows immediately (no pre-show delay) when leaving a /play/ route and holds for PLAYER_EXIT_SPINNER_MS", () => {
    const { result, rerender } = renderHook(
      ({ pathname }) => useRouteTransitionSpinner(pathname),
      { initialProps: { pathname: "/play/12345" } },
    );
    expect(result.current).toBe(false);

    act(() => {
      rerender({ pathname: "/item/12345" });
    });
    // Shown synchronously — no pre-show delay for the player-exit case.
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(PLAYER_EXIT_SPINNER_MS - 1);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it("does not treat entering the player route as the exit case", () => {
    const { result, rerender } = renderHook(
      ({ pathname }) => useRouteTransitionSpinner(pathname),
      { initialProps: { pathname: "/" } },
    );

    rerender({ pathname: "/play/999" });
    // Entering /play/ is a regular navigation — never activates the overlay.
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);
  });

  it("resets stale visibility when a regular navigation starts while the player-exit spinner is still showing", () => {
    const { result, rerender } = renderHook(
      ({ pathname }) => useRouteTransitionSpinner(pathname),
      { initialProps: { pathname: "/play/1" } },
    );

    act(() => {
      rerender({ pathname: "/item/1" });
    });
    expect(result.current).toBe(true); // player-exit spinner showing

    // A second, regular navigation starts before the player-exit spinner
    // would have hidden itself — it must be cleared immediately, not left
    // to bleed into the new (non-player) navigation.
    act(() => {
      rerender({ pathname: "/item/2" });
    });
    expect(result.current).toBe(false);
  });
});
