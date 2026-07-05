import { useEffect, useRef, useState } from "react";
import { logger } from "../services/logger";

/**
 * Route-transition spinner — covers the gap between a route change and the
 * destination page's first paint.
 *
 * Two distinct cases (prexu-0szx.8):
 *
 *  1. Leaving the PlayBridge route (`/play/:ratingKey`). PlayBridge renders
 *     nothing and immediately replaces history with wherever playback was
 *     launched from (see PlayBridge.tsx), while the player overlay is still
 *     spinning up with no frame on screen yet. The destination page
 *     underneath needs a reliable, IMMEDIATE cover — shown with no
 *     pre-show delay, held for PLAYER_EXIT_SPINNER_MS. This is the one
 *     case the effect's original 600ms ceiling existed for.
 *
 *  2. Every other in-app navigation (Dashboard -> Library -> ItemDetail,
 *     etc.). Most of these paint instantly — the destination's lazy chunk
 *     and data are usually already cached — so unconditionally covering
 *     every navigation with an opaque overlay for hundreds of ms flashed a
 *     spinner over content that was already on screen. These get a short
 *     pre-show delay before the spinner is allowed to appear at all (so a
 *     fast/cached navigation never shows anything) and a shorter display
 *     ceiling once it does.
 *
 * Note: the player overlay itself (Player.tsx via PlayerOverlay) is
 * rendered outside the route tree and does not change `pathname` when it
 * opens or closes — starting/stopping playback never touches this hook.
 * Only the PlayBridge deep-link hand-off (`/play/:ratingKey` -> prior
 * route) does.
 */
export const PLAYER_EXIT_SPINNER_MS = 600;
export const REGULAR_NAV_PRE_SHOW_DELAY_MS = 150;
export const REGULAR_NAV_SPINNER_MS = 300;

const PLAYER_ROUTE_PREFIX = "/play/";

export function useRouteTransitionSpinner(pathname: string): boolean {
  const lastPathRef = useRef(pathname);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const previousPath = lastPathRef.current;
    lastPathRef.current = pathname;

    const leavingPlayerRoute =
      previousPath.startsWith(PLAYER_ROUTE_PREFIX) && previousPath !== pathname;

    if (leavingPlayerRoute) {
      logger.debug("layout", "transition spinner: player-route exit", {
        from: previousPath,
        to: pathname,
      });
      setVisible(true);
      const hideId = window.setTimeout(() => setVisible(false), PLAYER_EXIT_SPINNER_MS);
      return () => window.clearTimeout(hideId);
    }

    // Reset to a clean slate for every other transition so a stale
    // "visible" from a prior transition doesn't bleed into this one.
    setVisible(false);

    let hideId: ReturnType<typeof window.setTimeout> | undefined;
    const showId = window.setTimeout(() => {
      setVisible(true);
      hideId = window.setTimeout(() => setVisible(false), REGULAR_NAV_SPINNER_MS);
    }, REGULAR_NAV_PRE_SHOW_DELAY_MS);

    return () => {
      window.clearTimeout(showId);
      if (hideId !== undefined) window.clearTimeout(hideId);
    };
  }, [pathname]);

  return visible;
}
