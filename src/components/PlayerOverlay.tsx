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
 *
 * Owns the runtime engine-fallback remount (prexu-axj4.4): usePlayer()
 * inside Player.tsx locks its native-vs-HTML5 choice once per mount and
 * cannot flip it mid-session (rules of hooks). When native fails at
 * runtime (`player://engine-failed`) or a fresh session's pre-flight
 * check fails, useNativePlayer sets the module-level session-fallback
 * flag; this component subscribes to that flag and bumps `remountKey` to
 * force a full unmount + remount of <Player>, which re-resolves the
 * engine choice and this time picks HTML5.
 */

import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { usePlayerSession } from "../contexts/PlayerContext";
import { usePreferences } from "../hooks/usePreferences";
import ErrorBoundary from "./ErrorBoundary";
import {
  IS_NATIVE_PLAYER_PLATFORM,
  consumePendingResumeOffsetMs,
  isSessionFallbackActive,
  resolveEngineChoice,
  subscribeToEngineFallback,
  type ResolvedEngine,
} from "../hooks/player/engineResolution";
import { useTransparentWindow } from "../hooks/player/useTransparentWindow";
import { logger } from "../services/logger";

const Player = lazy(() => import("../pages/Player"));

export default function PlayerOverlay() {
  const { session, updateSession } = usePlayerSession();
  const { preferences } = usePreferences();

  // Forces a full unmount + remount of <Player> when a runtime fallback
  // fires — changing `key` is the only way to make usePlayer() re-run its
  // lazy useState initializer (see engineResolution.ts docblock).
  const [remountKey, setRemountKey] = useState(0);

  // Best-effort mirror of Player.tsx's own (independently-locked) engine
  // choice, used ONLY to gate the transparent-body class here. Re-derived
  // at the null→non-null "fresh session start" transition (a true play()
  // call — replaceRatingKey/episode-swap never causes that transition, so
  // this doesn't flip mid-session) and forced to "html5" immediately when
  // a fallback fires, ahead of Player.tsx's own remount landing.
  const [overlayEngine, setOverlayEngine] = useState<ResolvedEngine>("html5");
  const wasSessionActiveRef = useRef(false);

  useEffect(() => {
    const hasSession = session != null;
    const isFreshStart = hasSession && !wasSessionActiveRef.current;
    wasSessionActiveRef.current = hasSession;
    if (!isFreshStart) return;
    setOverlayEngine(
      resolveEngineChoice({
        platformCapable: IS_NATIVE_PLAYER_PLATFORM,
        playerEngine: preferences.playback.playerEngine,
        sessionFallback: isSessionFallbackActive(),
      }),
    );
  }, [session, preferences.playback.playerEngine]);

  useEffect(() => {
    return subscribeToEngineFallback(() => {
      logger.warn("player", "engine-failed fallback — remounting Player into HTML5");
      // Best-effort resume: if useNativePlayer stashed a last-known
      // position ahead of the fallback (mid-session failure — the
      // pre-flight-check path never gets far enough to have one), carry
      // it into the remounted session's offset so HTML5 resumes close to
      // where native left off instead of restarting from scratch.
      const resumeOffsetMs = consumePendingResumeOffsetMs();
      if (resumeOffsetMs != null) {
        updateSession({ offset: resumeOffsetMs });
      }
      setOverlayEngine("html5");
      setRemountKey((k) => k + 1);
    });
  }, [updateSession]);

  // Single owner of body.player-transparent — toggled whenever a session
  // is active on the native-mpv path so the Win32/Linux host window shows
  // through the WebView. Idempotent + no-op elsewhere. useTransparentWindow
  // itself defers applying the class until mpv signals a real frame (or a
  // safety-net timeout), so a brief mismatch here during fallback isn't a
  // black-screen risk — see useTransparentWindow's docblock.
  useTransparentWindow(overlayEngine === "native" && session != null);

  if (!session) return null;
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <Player
          key={remountKey}
          ratingKey={session.ratingKey}
          offset={session.offset ?? null}
          watchTogether={session.watchTogether}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
