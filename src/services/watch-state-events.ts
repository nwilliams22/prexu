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
}

/**
 * Fire after the server's watch state for an item has been updated.
 *
 * `ratingKey` is optional so existing call sites (and any future ones that
 * don't have it handy) keep compiling — passing it lets listeners (e.g.
 * item-detail cache invalidation, prexu-lz4t) target just the affected
 * item instead of sweeping every cached entry.
 */
export function emitWatchStateChanged(ratingKey?: string): void {
  if (typeof window === "undefined") return;
  const detail: WatchStateChangedDetail | undefined = ratingKey
    ? { ratingKey }
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
