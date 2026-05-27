/**
 * Single owner of `body.player-transparent` for the native-mpv path.
 *
 * A dedicated hook (rather than inline body.style mutation) ensures a single
 * CSS class (`--bg-primary` in styles.css) is the source of truth.
 *
 * The class is DEFERRED until either:
 *   - Rust emits `player://host-window-ready` (mpv has decoded + composited
 *     its first frame on the new file), or
 *   - The safety-net timeout fires (HOST_READY_FALLBACK_MS, currently 250ms).
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
 * Safety-net for the host-ready event. Long enough to cover the common
 * mpv first-frame latency on warm starts (single-digit ms) and on cold
 * starts (typically <100ms once libmpv is initialised), short enough
 * that the user perceives an opaque window rather than a flash if the
 * event never fires.
 */
const HOST_READY_FALLBACK_MS = 250;

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
