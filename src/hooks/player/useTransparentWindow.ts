/**
 * Single owner of `body.player-transparent` for the native-mpv path.
 *
 * A dedicated hook (rather than inline body.style mutation) ensures a single
 * CSS class (`--bg-primary` in styles.css) is the source of truth. Multiple
 * call sites previously wrote `document.body.style.background` with the
 * literal colour value, which drifted from the CSS variable.
 *
 * The class is added in useLayoutEffect (synchronous before paint) so
 * the first painted frame already has the transparent body. Cleanup
 * runs synchronously on unmount so the post-unmount frame is opaque
 * again — same render-cycle guarantee the inline-style approach had.
 *
 * Belt-and-suspenders: usePlayerLifecycle.prepareNavAway also removes
 * the class one render-cycle before the actual unmount. WebView2 with
 * `transparent: true` has been observed compositing one transparent
 * frame during the Player→underneath swap even when the cleanup runs
 * synchronously. Removing the class while Player is still mounted
 * eliminates that race.
 */

import { useLayoutEffect } from "react";

export const TRANSPARENT_BODY_CLASS = "player-transparent";

export function useTransparentWindow(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    document.body.classList.add(TRANSPARENT_BODY_CLASS);
    return () => {
      document.body.classList.remove(TRANSPARENT_BODY_CLASS);
    };
  }, [active]);
}
