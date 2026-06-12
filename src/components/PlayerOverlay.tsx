/**
 * Top-level player mount point. Reads the active session from
 * PlayerContext and renders Player.tsx when a session exists.
 *
 * Sits at App.tsx top level — outside the route tree — so the page the
 * user launched playback from stays mounted underneath the overlay.
 * When PlayerContext.stop() runs, Player unmounts and the underlying
 * page is instantly visible (no remount, no spinner, no navy gap).
 *
 * Reuses the same lazy-loaded Player chunk so first-open still benefits
 * from code splitting; subsequent opens are synchronous because the
 * chunk is cached.
 */

import { lazy, Suspense } from "react";
import { usePlayerSession } from "../contexts/PlayerContext";
import ErrorBoundary from "./ErrorBoundary";
import { IS_NATIVE_PLAYER } from "../hooks/usePlayer";
import { useTransparentWindow } from "../hooks/player/useTransparentWindow";

const Player = lazy(() => import("../pages/Player"));

export default function PlayerOverlay() {
  const { session } = usePlayerSession();
  // Single owner of body.player-transparent — toggled whenever a session
  // is active on the native-mpv (Windows) path so the Win32 host HWND
  // shows through the WebView. Idempotent + no-op elsewhere.
  useTransparentWindow(IS_NATIVE_PLAYER && session != null);
  if (!session) return null;
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <Player
          ratingKey={session.ratingKey}
          offset={session.offset ?? null}
          watchTogether={session.watchTogether}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
