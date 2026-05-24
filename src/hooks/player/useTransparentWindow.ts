/**
 * Single owner of `body.player-transparent` for the native-mpv path.
 *
 * Why a hook (not inline body.style mutation across the player tree):
 * pre-prexu-r3l, three call sites wrote `document.body.style.background`
 * (Player.tsx useLayoutEffect on mount/unmount; usePlayerLifecycle
 * prepareNavAway; a parallel AppLayout mask system fighting the same
 * "don't flash desktop pixels" problem). The literal "#1a1a2e" was
 * duplicated in two of them, drifting from the CSS source of truth
 * (--bg-primary). One owner here, one CSS rule in styles.css.
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
