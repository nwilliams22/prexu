/**
 * Player lifecycle hook — owns the "exit the player overlay" choreography.
 *
 * Extracted from Player.tsx (prexu-ps6) so the three previously-duplicated
 * fullscreen-exit dance variants live in one place:
 *   - `exit`: full teardown (popout-exit if needed → fullscreen exit →
 *     mpv unload → playerSession.stop).
 *   - `prepareNavAway`: pre-navigation cleanup for the unmount path
 *     (body-bg paint + fullscreen exit). Used by lifecycle.exit and by
 *     any future caller that needs the same band-aid before navigation.
 *   - `navAwayPreservingMount`: fullscreen exit + run a supplied nav
 *     callback. Used by the Previous-episode button where Player stays
 *     mounted across ratingKey swaps and the useLayoutEffect cleanup
 *     never re-runs (so we deliberately DON'T paint body opaque).
 *
 * The body-bg dance is intentionally preserved verbatim here — its
 * structural fix is tracked separately as prexu-r3l.
 */

import { useCallback } from "react";
import { IS_NATIVE_PLAYER, type UsePlayerResult } from "../usePlayer";
import type { UsePopOutPlayerResult } from "./usePopOutPlayer";
import type { PlayerContextValue } from "../../contexts/PlayerContext";
import { logger } from "../../services/logger";

export interface UsePlayerLifecycleArgs {
  player: UsePlayerResult;
  popOut: UsePopOutPlayerResult;
  playerSession: PlayerContextValue;
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
  const exitFullscreenIfActive = useCallback(async () => {
    if (!isFullscreenRef.current) return;
    try {
      await player.setFullscreen(false);
    } catch {
      // Swallow — cleanup path's fullscreen-exit safety net catches up.
    }
  }, [isFullscreenRef, player]);

  // Pre-exit cleanup: paint body opaque + drop fullscreen before tearing
  // mpv down. The useLayoutEffect cleanup in Player.tsx SHOULD run sync
  // before paint, but in practice WebView2 with transparent:true can
  // still composite one frame where body=transparent during the
  // Player→underneath swap, leaking whatever OS window is behind Prexu
  // (Discord). Doing it here runs while Player is still mounted — the
  // Player container is fixed+transparent so mpv is still visible to
  // the user, but the next post-unmount paint has body already navy.
  // Belt-and-suspenders: cleanup still runs, idempotent second write.
  //
  // The body-bg consolidation lives in prexu-r3l; keep this band-aid
  // intact for now.
  const prepareNavAway = useCallback(async () => {
    // Paint body navy unconditionally. On HTML5 this is effectively a no-op
    // (nothing made body transparent); on native it matches the Player.tsx
    // useLayoutEffect cleanup that paints body navy on unmount. The body-bg
    // consolidation lives in prexu-r3l — the IS_NATIVE_PLAYER guard that
    // used to wrap this line is removed as part of prexu-ve9 (HTML5 path is
    // idempotent against the default styling).
    document.body.style.background = "#1a1a2e";
    await exitFullscreenIfActive();
  }, [exitFullscreenIfActive]);

  // Exit = close the player overlay. The page underneath stays mounted
  // (AppLayout never unmounted), so the user is back where they launched
  // from instantly — no route navigation, no remount, no spinner.
  // Audio is silenced synchronously by the awaited player_unload (the
  // pump-join + final mpv terminate happen in the background — see
  // src-tauri/src/player/mod.rs destroy()).
  const exit = useCallback(async () => {
    logger.info("player", "handleExit start");
    // If we're in pop-out mode, exit it FIRST so the main window is
    // restored to its pre-pop-out outer geometry and always-on-top is
    // cleared before we unload the player. Without this the app stays at
    // the 480x270 pop-out size after the player closes (prexu-ltu / mw5
    // follow-up).
    if (IS_NATIVE_PLAYER && popOut.isPopOut) {
      try {
        popOut.togglePopOut();
      } catch (err) {
        logger.warn("player", "handleExit exit-popout failed", String(err));
      }
    }
    await prepareNavAway();
    try {
      // Dispatches to backend: native runs player_unload (silences audio
      // synchronously); HTML5 is a no-op (unmount cleanup handles it).
      await player.unload();
    } catch (err) {
      logger.warn("player", "handleExit player.unload failed", String(err));
    }
    playerSession.stop();
  }, [prepareNavAway, playerSession, popOut, player]);

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

  return { exit, prepareNavAway, navAwayPreservingMount };
}
