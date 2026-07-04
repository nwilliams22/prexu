/**
 * Single owner of `body.player-transparent` for the native-mpv path.
 *
 * A dedicated hook (rather than inline body.style mutation) ensures a single
 * CSS class (`--bg-primary` in styles.css) is the source of truth.
 *
 * The class is DEFERRED on initial mount until either:
 *   - Rust emits `player://host-window-ready` — the first frame of the new
 *     file is actually on screen (Windows: mpv composited into the host HWND
 *     on the first PlaybackRestart; Linux: the GtkGLArea rendered the first
 *     frame after the event pump armed the reveal, prexu-91t8), or
 *   - The safety-net timeout fires (HOST_READY_FALLBACK_MS).
 *
 * Deferring fixes prexu-mto: previously the class was added synchronously on
 * mount, so on Resume-from-Beginning the body went transparent for the few
 * frames before mpv drew anything — leaking the desktop / app behind Prexu
 * through the WebView. Now the body stays opaque until mpv is ready.
 *
 * During mode TRANSITIONS (e.g. popout → minimize, popout-exit, etc.) the
 * Rust command emits `player://host-window-busy` BEFORE doing geometry work
 * and `player://host-window-ready` AFTER it settles. This hook drops the
 * transparent class on busy and re-adds it on ready (deferred by a rAF +
 * forced layout read so WebView2 commits the underlying route's paint
 * before transparency comes back). Without this, the WebView returns to
 * full-main size while the dashboard route is still painting, exposing
 * the desktop through the transparent body (prexu-7d3).
 *
 * Cleanup runs synchronously on unmount (useLayoutEffect cleanup) so the
 * post-unmount frame is opaque again — same render-cycle guarantee the
 * inline-style approach had.
 *
 * Belt-and-suspenders: usePlayerLifecycle.prepareNavAway also removes
 * the class one render-cycle before the actual unmount. WebView2 with
 * `transparent: true` has been observed compositing one transparent
 * frame during the Player→underneath swap even when the cleanup runs
 * synchronously. Removing the class while Player is still mounted
 * eliminates that race.
 */

import { useLayoutEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "../../services/logger";

export const TRANSPARENT_BODY_CLASS = "player-transparent";

/**
 * Safety-net for the host-ready event. Sized to be longer than the
 * realistic mpv `loadfile → PlaybackRestart` window so the event wins
 * the race in the common case. Empirically (2026-05-27 dev log) the
 * sequence after a user click is:
 *
 *   t+0     useTransparentWindow mounts, starts deferring
 *   t+~50   player_load_url IPC, ensure_init, mpv loadfile
 *   t+~900  FileLoaded
 *   t+~1000 PlaybackRestart → player://host-window-ready
 *
 * The original 250ms fallback fired well before the event, defeating
 * the defer. 3000ms covers cold-start, hwdec probe re-runs, and slow
 * network demuxer-open without making a stuck-opaque case visibly
 * laggy if the event truly never arrives.
 *
 * Exported so tests can drive timers off the same value.
 */
export const HOST_READY_FALLBACK_MS = 3000;

export function useTransparentWindow(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;

    let cancelled = false;
    let unlistenReady: UnlistenFn | undefined;
    let unlistenBusy: UnlistenFn | undefined;
    let initialTimer: ReturnType<typeof setTimeout> | undefined;
    let initialApplied = false;
    let pendingReadyRaf: number | null = null;

    const cancelPendingReady = () => {
      if (pendingReadyRaf !== null) {
        cancelAnimationFrame(pendingReadyRaf);
        pendingReadyRaf = null;
      }
    };

    const addClass = (reason: string) => {
      if (cancelled) return;
      document.body.classList.add(TRANSPARENT_BODY_CLASS);
      logger.debug("player:transparent", `applied (${reason})`);
    };

    const removeClass = (reason: string) => {
      if (cancelled) return;
      document.body.classList.remove(TRANSPARENT_BODY_CLASS);
      logger.debug("player:transparent", `removed (${reason})`);
    };

    const initialApply = (reason: "event" | "timeout") => {
      if (cancelled || initialApplied) return;
      initialApplied = true;
      if (initialTimer !== undefined) {
        clearTimeout(initialTimer);
        initialTimer = undefined;
      }
      addClass(reason);
    };

    // Transition-busy: a Rust command is mid-flight on a mode change
    // that resizes the main window or repaints the underlying route.
    // Drop the transparent class so the navy body bg fills the WebView
    // while the dashboard / detail page paints. No-op if we haven't
    // applied the initial class yet (mpv hasn't shown a frame).
    const onBusy = () => {
      if (cancelled || !initialApplied) return;
      cancelPendingReady();
      removeClass("transition-busy");
    };

    // host-window-ready serves two roles:
    //   1. Initial-frame signal from events.rs (first PlaybackRestart per
    //      file) — drives the initial defer.
    //   2. Transition-complete signal from popout/minimize commands —
    //      drives the re-add after a busy/ready pair.
    // For #2 we defer the re-add by two rAF + sync layout read so
    // WebView2 commits the underlying route's paint before transparency
    // returns (same trick as prexu-uzk's dashboard reflow fix).
    const onReady = () => {
      if (cancelled) return;
      if (!initialApplied) {
        initialApply("event");
        return;
      }
      cancelPendingReady();
      pendingReadyRaf = requestAnimationFrame(() => {
        pendingReadyRaf = null;
        if (cancelled) return;
        void document.body.offsetHeight;
        pendingReadyRaf = requestAnimationFrame(() => {
          pendingReadyRaf = null;
          if (cancelled) return;
          addClass("transition-ready");
        });
      });
    };

    listen("player://host-window-ready", onReady)
      .then((u) => {
        if (cancelled) {
          u();
          return;
        }
        unlistenReady = u;
      })
      .catch((err) => {
        logger.warn(
          "player:transparent",
          "listen(player://host-window-ready) failed",
          String(err),
        );
      });

    listen("player://host-window-busy", onBusy)
      .then((u) => {
        if (cancelled) {
          u();
          return;
        }
        unlistenBusy = u;
      })
      .catch((err) => {
        logger.warn(
          "player:transparent",
          "listen(player://host-window-busy) failed",
          String(err),
        );
      });

    initialTimer = setTimeout(
      () => initialApply("timeout"),
      HOST_READY_FALLBACK_MS,
    );

    return () => {
      cancelled = true;
      if (initialTimer !== undefined) clearTimeout(initialTimer);
      cancelPendingReady();
      unlistenReady?.();
      unlistenBusy?.();
      document.body.classList.remove(TRANSPARENT_BODY_CLASS);
    };
  }, [active]);
}
