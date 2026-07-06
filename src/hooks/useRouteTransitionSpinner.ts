import { useEffect, useRef, useState } from "react";
import { logger } from "../services/logger";

/**
 * Route-transition spinner — covers the gap between leaving the PlayBridge
 * route and the destination page's first paint.
 *
 * (prexu-xb3h) This used to also cover "every other in-app navigation"
 * (Dashboard -> Library -> ItemDetail, etc.) via a 150ms pre-show delay +
 * 300ms display ceiling, on the theory that most of those paint instantly
 * so the delay would keep it invisible in practice. That branch was
 * READINESS-BLIND — it is a pair of plain `setTimeout`s with no check for
 * whether the destination has actually painted, so its "invisible in
 * practice" premise only holds if the JS main thread stays free enough to
 * fire those timers close to their nominal delays. It does not: each
 * timer is scheduled relative to when the PREVIOUS one actually ran, so a
 * congested main thread (e.g. Dashboard's own staged shelf-mounting work,
 * see Dashboard.tsx's shelfStage — mounting ~80 PosterCards per shelf) can
 * push both the 150ms show and the 300ms hide out by seconds. The result:
 * pressing Back from an item detail page to the dashboard would show the
 * dashboard, THEN an opaque spinner over it for however long the main
 * thread stayed busy, THEN the dashboard again — with no route change,
 * no remount, and no player-route exit involved at all.
 *
 * Every in-app destination (Dashboard, LibraryView, ItemDetail,
 * ActorDetail, DiscoverDetail, ...) already renders its own skeleton/
 * loading UI, so this overlay was purely redundant for those cases on top
 * of being actively harmful under load. Fix: this hook now ONLY covers the
 * PlayBridge exit gap.
 *
 * Leaving `/play/:ratingKey`: PlayBridge renders nothing and immediately
 * replaces history with wherever playback was launched from (see
 * PlayBridge.tsx), while the player overlay is still spinning up with no
 * frame on screen yet. The destination page underneath needs a reliable,
 * IMMEDIATE cover — shown with no pre-show delay, held for
 * PLAYER_EXIT_SPINNER_MS.
 *
 * Note: the player overlay itself (Player.tsx via PlayerOverlay) is
 * rendered outside the route tree and does not change `pathname` when it
 * opens or closes — starting/stopping playback never touches this hook.
 * Only the PlayBridge deep-link hand-off (`/play/:ratingKey` -> prior
 * route) does.
 */
export const PLAYER_EXIT_SPINNER_MS = 600;

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
      logger.debug("layout", "transition spinner: activated (player-route exit)", {
        from: previousPath,
        to: pathname,
        holdMs: PLAYER_EXIT_SPINNER_MS,
      });
      setVisible(true);
      const hideId = window.setTimeout(() => {
        logger.debug("layout", "transition spinner: deactivated (player-exit hold elapsed)", {
          from: previousPath,
          to: pathname,
        });
        setVisible(false);
      }, PLAYER_EXIT_SPINNER_MS);
      return () => window.clearTimeout(hideId);
    }

    // Every other transition (including detail -> dashboard back-nav) never
    // activates this overlay — destination pages own their own loading UI.
    // Reset to a clean slate so a stale "visible" from a still-pending
    // player-exit hold doesn't bleed into this navigation.
    if (visible) {
      logger.debug("layout", "transition spinner: deactivated (non-player nav, not scoped)", {
        from: previousPath,
        to: pathname,
      });
    }
    setVisible(false);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `visible` is read only to log; including it would re-fire this effect on every visibility flip
  }, [pathname]);

  return visible;
}
