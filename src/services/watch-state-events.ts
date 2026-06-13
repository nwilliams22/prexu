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

/** Fire after the server's watch state for an item has been updated. */
export function emitWatchStateChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WATCH_STATE_CHANGED));
}

/**
 * Subscribe to watch-state changes. Returns an unsubscribe function suitable
 * for a `useEffect` cleanup.
 */
export function onWatchStateChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(WATCH_STATE_CHANGED, handler);
  return () => window.removeEventListener(WATCH_STATE_CHANGED, handler);
}
