/**
 * Single owner of `body.player-transparent` for the native-mpv path.
 *
 * A dedicated hook (rather than inline body.style mutation) ensures a single
 * CSS class (`--bg-primary` in styles.css) is the source of truth.
 *
 * The class is DEFERRED until either:
 *   - Rust emits `player://host-window-ready` (mpv has decoded + composited
 *     its first frame on the new file), or
 *   - The safety-net timeout fires (HOST_READY_FALLBACK_MS).
 *
 * Deferring fixes prexu-mto: previously the class was added synchronously on
 * mount, so on Resume-from-Beginning the body went transparent for the few
 * frames before mpv drew anything — leaking the desktop / app behind Prexu
 * through the WebView. Now the body stays opaque until mpv is ready.
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
    let unlisten: UnlistenFn | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = (reason: "event" | "timeout") => {
      if (cancelled) return;
      // Once-only: tear down both signals on first success so we don't
      // re-fire on the next event or burn the timeout pointlessly.
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (unlisten) {
        unlisten();
        unlisten = undefined;
      }
      document.body.classList.add(TRANSPARENT_BODY_CLASS);
      logger.debug("player:transparent", `applied (${reason})`);
    };

    listen("player://host-window-ready", () => apply("event"))
      .then((u) => {
        if (cancelled) {
          u();
          return;
        }
        // If the event already arrived before listen() resolved we'd
        // miss it — that's exactly what the safety-net is for.
        unlisten = u;
      })
      .catch((err) => {
        logger.warn(
          "player:transparent",
          "listen(player://host-window-ready) failed",
          String(err),
        );
      });

    timer = setTimeout(() => apply("timeout"), HOST_READY_FALLBACK_MS);

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (unlisten) unlisten();
      document.body.classList.remove(TRANSPARENT_BODY_CLASS);
    };
  }, [active]);
}
