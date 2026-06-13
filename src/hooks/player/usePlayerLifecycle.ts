/**
 * Player lifecycle hook — owns the "exit the player overlay" choreography.
 *
 * Three exported callbacks:
 *   - `exit`: full teardown (popout-exit if needed → fullscreen exit →
 *     mpv unload → playerSession.stop).
 *   - `prepareNavAway`: pre-navigation cleanup for the unmount path
 *     (body-bg paint + fullscreen exit). Used by lifecycle.exit and by
 *     any future caller that needs the same cleanup before navigation.
 *   - `navAwayPreservingMount`: fullscreen exit + run a supplied nav
 *     callback. Used by the Previous-episode button where Player stays
 *     mounted across ratingKey swaps (so we deliberately DON'T paint
 *     body opaque — the cleanup effect never re-runs).
 */

import { useCallback, useMemo } from "react";
import { IS_NATIVE_PLAYER, type UsePlayerResult } from "../usePlayer";
import type { UsePopOutPlayerResult } from "./usePopOutPlayer";
import type { PlayerSessionContextValue } from "../../contexts/PlayerContext";
import { logger } from "../../services/logger";
import { TRANSPARENT_BODY_CLASS } from "./useTransparentWindow";

export interface UsePlayerLifecycleArgs {
  player: UsePlayerResult;
  popOut: UsePopOutPlayerResult;
  /** Only `.stop` is read — narrowed to the session slice now that
   *  minimize lives on its own context (prexu-ii3). */
  playerSession: Pick<PlayerSessionContextValue, "stop">;
  /**
   * Ref to the latest `player.isFullscreen`. Player.tsx owns the ref +
   * keeps it synced; this hook reads it from the ref so the exit
   * callbacks can stay stable across fullscreen toggles.
   */
  isFullscreenRef: React.MutableRefObject<boolean>;
}

export interface UsePlayerLifecycleResult {
  /** Close the player overlay. Idempotent. Handles popout-exit, body-bg
   *  restore (native), fullscreen-exit, mpv unload, then playerSession.stop(). */
  exit: () => Promise<void>;
  /** Pre-navigation cleanup for cases like Previous-episode swap where Player
   *  stays mounted across ratingKey changes (so the unmount-time useLayoutEffect
   *  cleanup doesn't run). Caller awaits before navigating. */
  prepareNavAway: () => Promise<void>;
  /** Exit fullscreen if active, then call the supplied navigation function.
   *  Used by Previous button which keeps Player mounted. */
  navAwayPreservingMount: (nav: () => void) => Promise<void>;
}

export function usePlayerLifecycle({
  player,
  popOut,
  playerSession,
  isFullscreenRef,
}: UsePlayerLifecycleArgs): UsePlayerLifecycleResult {
  // Single source of truth for "if we're currently fullscreen, drop it".
  // Used by all three callbacks. Swallows errors — the unload path's
  // teardown is the safety net. Dispatches through player.setFullscreen
  // so the backend (native = mpv via invoke, HTML5 = document.exitFullscreen)
  // owns the actual IPC. Skipped entirely when no fullscreen is active so
  // neither backend has to handle an unnecessary transition.
  //
  // Depends on the stable setFullscreen/unload callbacks rather than the
  // whole `player` object, whose identity changes on every time-pos tick
  // — keeping these callbacks (and the JSX props they feed) tick-stable.
  const { setFullscreen, unload } = player;
  const exitFullscreenIfActive = useCallback(async () => {
    if (!isFullscreenRef.current) return;
    try {
      await setFullscreen(false);
    } catch {
      // Swallow — cleanup path's fullscreen-exit safety net catches up.
    }
  }, [isFullscreenRef, setFullscreen]);

  // Pre-exit cleanup: paint body opaque + drop fullscreen before tearing
  // mpv down. The useLayoutEffect cleanup in Player.tsx SHOULD run sync
  // before paint, but in practice WebView2 with transparent:true can
  // still composite one frame where body=transparent during the
  // Player→underneath swap, leaking whatever OS window is behind Prexu
  // (Discord). Doing it here runs while Player is still mounted — the
  // Player container is fixed+transparent so mpv is still visible to
  // the user, but the next post-unmount paint has body already navy.
  // Belt-and-suspenders: remove the player-transparent body class one
  // render-cycle BEFORE the actual unmount runs useTransparentWindow's
  // cleanup. WebView2 with `transparent: true` has been observed
  // compositing a transparent frame during the Player→underneath swap
  // even when the cleanup runs synchronously, leaking whatever OS window
  // sits behind Prexu. Removing the class while Player is still mounted
  // forces the post-paint frame opaque. The hook's unmount cleanup is
  // idempotent — running classList.remove twice is a no-op.
  //
  // No-op on HTML5: the class is never added there (useTransparentWindow
  // is gated on IS_NATIVE_PLAYER inside PlayerOverlay).
  const prepareNavAway = useCallback(async () => {
    document.body.classList.remove(TRANSPARENT_BODY_CLASS);
    await exitFullscreenIfActive();
  }, [exitFullscreenIfActive]);

  // Exit = close the player overlay. The page underneath stays mounted
  // (AppLayout never unmounted), so the user is back where they launched
  // from instantly — no route navigation, no remount, no spinner.
  // Audio is silenced synchronously by the awaited player_unload (the
  // pump-join + final mpv terminate happen in the background — see
  // src-tauri/src/player/mod.rs destroy()).
  const { isPopOut, togglePopOut } = popOut;
  const exit = useCallback(async () => {
    logger.info("player", "handleExit start");
    // If we're in pop-out mode, exit it FIRST so the main window is
    // restored to its pre-pop-out outer geometry and always-on-top is
    // cleared before we unload the player. Without this the app stays at
    // the pop-out size after the player closes.
    if (IS_NATIVE_PLAYER && isPopOut) {
      try {
        togglePopOut();
      } catch (err) {
        logger.warn("player", "handleExit exit-popout failed", String(err));
      }
    }
    await prepareNavAway();
    try {
      // Dispatches to backend: native runs player_unload (silences audio
      // synchronously); HTML5 is a no-op (unmount cleanup handles it).
      await unload();
    } catch (err) {
      logger.warn("player", "handleExit player.unload failed", String(err));
    }
    playerSession.stop();
  }, [prepareNavAway, playerSession, isPopOut, togglePopOut, unload]);

  // Previous = go to the prior episode/queue item. Mirrors handleNextEpisode
  // shape: queue first, then Plex episode-nav fallback. We deliberately do
  // NOT paint body opaque here even though prepareNavAway would: Player
  // stays mounted across ratingKey swaps (the new context.replaceRatingKey
  // mutates the session in place so the overlay doesn't unmount), so the
  // useLayoutEffect that paints body transparent doesn't re-run. Painting
  // it opaque on the way out without the cleanup ever firing leaves the
  // user staring at a navy background while mpv plays invisibly underneath.
  // Fullscreen exit is still safe — that's a one-shot Win32 call, not a paint.
  const navAwayPreservingMount = useCallback(
    async (nav: () => void) => {
      await exitFullscreenIfActive();
      nav();
    },
    [exitFullscreenIfActive],
  );

  // Memoized so consumers can list `lifecycle` itself in dep arrays / memo
  // props without re-firing on every render of the owning component.
  return useMemo(
    () => ({ exit, prepareNavAway, navAwayPreservingMount }),
    [exit, prepareNavAway, navAwayPreservingMount],
  );
}
