import { act, renderHook } from "@testing-library/react";
import {
  useRouteTransitionSpinner,
  PLAYER_EXIT_SPINNER_MS,
  REGULAR_NAV_PRE_SHOW_DELAY_MS,
  REGULAR_NAV_SPINNER_MS,
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
    // Still false immediately after the change — no flash for cached/fast loads.
    expect(result.current).toBe(false);
  });

  it("never appears if the destination is already painted before the pre-show delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ pathname }) => useRouteTransitionSpinner(pathname),
      { initialProps: { pathname: "/" } },
    );

    rerender({ pathname: "/library/1" });
    act(() => {
      vi.advanceTimersByTime(REGULAR_NAV_PRE_SHOW_DELAY_MS - 1);
    });
    expect(result.current).toBe(false);
  });

  it("shows a regular-nav spinner only after the pre-show delay, then hides after the ceiling", () => {
    const { result, rerender } = renderHook(
      ({ pathname }) => useRouteTransitionSpinner(pathname),
      { initialProps: { pathname: "/" } },
    );

    rerender({ pathname: "/library/1" });
    act(() => {
      vi.advanceTimersByTime(REGULAR_NAV_PRE_SHOW_DELAY_MS);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(REGULAR_NAV_SPINNER_MS - 1);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
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
    // Entering /play/ is a regular navigation — delayed, not immediate.
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(REGULAR_NAV_PRE_SHOW_DELAY_MS);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(REGULAR_NAV_SPINNER_MS);
    });
    expect(result.current).toBe(false);
  });

  it("resets stale visibility when a new navigation starts while the previous spinner is showing", () => {
    const { result, rerender } = renderHook(
      ({ pathname }) => useRouteTransitionSpinner(pathname),
      { initialProps: { pathname: "/play/1" } },
    );

    act(() => {
      rerender({ pathname: "/item/1" });
    });
    expect(result.current).toBe(true); // player-exit spinner showing

    // A second, regular navigation starts before the player-exit spinner
    // would have hidden itself.
    act(() => {
      rerender({ pathname: "/item/2" });
    });
    expect(result.current).toBe(false);
  });
});
