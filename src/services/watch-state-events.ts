/**
 * Lightweight in-process event for "a playback watch-state change happened"
 * (resume offset cleared on early stop, or a new resume offset recorded).
 *
 * The player overlay and the dashboard live in separate React subtrees that
 * never unmount each other, so the dashboard's Continue Watching shelf does not
 * naturally refetch when playback stops. The player emits this event after the
 * server has been updated; the dashboard listens and refreshes On Deck.
 *
 * Uses a DOM CustomEvent so it crosses subtree boundaries without a shared
 * context, and is a no-op under SSR / non-DOM test environments.
 */

const WATCH_STATE_CHANGED = "prexu:watch-state-changed";

/** Payload carried on the watch-state-changed CustomEvent, when known. */
export interface WatchStateChangedDetail {
  /** ratingKey of the item whose watch state just changed. */
  ratingKey?: string;
  /**
   * The final viewOffset (ms) known at stop time, when available (prexu-8nl0).
   * The player knows this authoritatively the moment it emits this event —
   * it's the exact value just beaconed to (or, for an early-stop clear,
   * enforced against) the server. Consumers can patch their own caches with
   * this value immediately instead of waiting on a refetch to eventually
   * reflect it — see cache-invalidators.ts for why a refetch alone can race
   * PMS's own async ingestion of the write and re-cache stale data.
   */
  viewOffsetMs?: number;
  /**
   * True when `viewOffsetMs` reflects an early-stop resume-marker CLEAR
   * (`/:/unscrobble` — watched under the 60s threshold, see
   * useTimelineReporting's reportStopped) rather than a recorded resume
   * position. Lets consumers treat `viewOffsetMs: 0` as authoritative ("this
   * item has no resume point") instead of an ambiguous/unknown zero.
   */
  reset?: boolean;
}

/** Offset payload optionally passed to {@link emitWatchStateChanged}. */
export interface WatchStateOffset {
  viewOffsetMs: number;
  reset?: boolean;
}

/**
 * Fire after the server's watch state for an item has been updated.
 *
 * `ratingKey` is optional so existing call sites (and any future ones that
 * don't have it handy) keep compiling — passing it lets listeners (e.g.
 * item-detail cache invalidation, prexu-lz4t) target just the affected
 * item instead of sweeping every cached entry. `offset` is likewise optional
 * (prexu-8nl0) — when the caller knows the final viewOffset at stop time, it
 * lets listeners patch caches directly instead of relying on a refetch.
 */
export function emitWatchStateChanged(
  ratingKey?: string,
  offset?: WatchStateOffset,
): void {
  if (typeof window === "undefined") return;
  const detail: WatchStateChangedDetail | undefined =
    ratingKey || offset
      ? { ratingKey, viewOffsetMs: offset?.viewOffsetMs, reset: offset?.reset }
      : undefined;
  window.dispatchEvent(
    new CustomEvent<WatchStateChangedDetail | undefined>(WATCH_STATE_CHANGED, {
      detail,
    }),
  );
}

/**
 * Subscribe to watch-state changes. Returns an unsubscribe function suitable
 * for a `useEffect` cleanup.
 *
 * `handler` receives the ratingKey when the emitter had one available, or
 * `undefined` otherwise. Existing handlers written as `() => void` (ignoring
 * the argument) remain valid — this is a backward-compatible signature
 * change, not a breaking one.
 *
 * This intentionally does NOT forward `viewOffsetMs`/`reset` — callers that
 * need the full payload (the cache-patch consumers, prexu-8nl0) should use
 * {@link onWatchStateChangedDetail} instead. Keeping this signature frozen
 * means every existing subscriber (and the tests asserting exactly how they're
 * called) keeps working unchanged.
 */
export function onWatchStateChanged(
  handler: (ratingKey?: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<WatchStateChangedDetail | undefined>)
      .detail;
    handler(detail?.ratingKey);
  };
  window.addEventListener(WATCH_STATE_CHANGED, listener);
  return () => window.removeEventListener(WATCH_STATE_CHANGED, listener);
}

/**
 * Subscribe to watch-state changes with the FULL event detail — ratingKey
 * plus `viewOffsetMs`/`reset` when the emitter had them (prexu-8nl0). For
 * consumers (cache-invalidators.ts's optimistic cache patch) that need the
 * offset payload rather than just the ratingKey that {@link onWatchStateChanged}
 * exposes. Returns an unsubscribe function suitable for a `useEffect` cleanup.
 */
export function onWatchStateChangedDetail(
  handler: (detail: WatchStateChangedDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<WatchStateChangedDetail | undefined>)
      .detail;
    handler(detail ?? {});
  };
  window.addEventListener(WATCH_STATE_CHANGED, listener);
  return () => window.removeEventListener(WATCH_STATE_CHANGED, listener);
}
