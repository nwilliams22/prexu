import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { logger } from "../services/logger";
import { playerEnterMinimize, playerExitMinimize, playerUpdateMiniGeometry } from "../services/player";
import { SUPPORTS_PLAYER_WINDOWING } from "../hooks/player/engineResolution";
import {
  DEFAULT_MINI_RECT,
  loadPersistedMiniRect,
  saveMiniRect,
  type MiniCorner,
  type MiniRect,
} from "../utils/mini-rect";

/**
 * Watch Together connection details that travel with the player session.
 * Set when the user joined a WT session via invite URL or created one
 * from the SessionCreator. Player.tsx reads these and passes them into
 * useWatchTogether() to bootstrap the relay connection.
 */
export interface PlayerWatchTogether {
  sessionId: string;
  isHost: boolean;
  /** Optional relay override (defaults to derived URL when absent). */
  relayUrl?: string;
}

/**
 * One active playback session. The PlayerOverlay reads this and decides
 * whether to mount Player.tsx; Player.tsx pulls ratingKey + options from
 * here instead of from the URL.
 */
export interface PlayerSession {
  ratingKey: string;
  /** When set, overrides the saved viewOffset (e.g. ?offset=0 = "from start"). */
  offset?: number;
  /** Watch Together connection info; absent for solo playback. */
  watchTogether?: PlayerWatchTogether;
}

export interface PlayOptions {
  offset?: number;
  watchTogether?: PlayerWatchTogether;
}

/**
 * Session controls — opening, closing, and swapping the active item.
 *
 * Split out of the prior combined PlayerContext (prexu-ii3) so that
 * isMinimized / miniRect changes don't cascade-invalidate every consumer
 * of `play`. Dashboard et al. only need this slice; minimize-toggle now
 * stays local to AppLayout + Player.tsx instead of repainting the Home
 * route tree.
 */
export interface PlayerSessionContextValue {
  /** Active session, or null when the player is closed. */
  session: PlayerSession | null;
  /**
   * Open the player on the given item. Replaces any existing session
   * (Player.tsx's ratingKey effect will tear down the old playback and
   * load the new one — same behaviour as the previous URL-based nav).
   */
  play: (ratingKey: string, options?: PlayOptions) => void;
  /** Close the player. mpv teardown happens in the background; the
   *  underlying page is instantly visible since AppLayout never unmounts. */
  stop: () => void;
  /**
   * Swap the active ratingKey in place. Used by in-player Prev/Next so
   * the user moves between episodes/playlist items without remounting
   * AppLayout or the destination page. Preserves WT session info so
   * the host can advance episodes within a shared session.
   */
  replaceRatingKey: (ratingKey: string) => void;
  /**
   * Apply a partial update to the active session — used by Watch Together
   * paths that need to clear the WT bundle without changing the
   * ratingKey (e.g. host clicks "Leave Session"). No-op if no session.
   */
  updateSession: (changes: Partial<PlayerSession>) => void;
}

/**
 * In-window minimize state + the persisted mini-player geometry.
 *
 * Kept on a separate context from the session controls so that the
 * frequent isMinimized / miniRect updates (drag, resize, corner-snap)
 * don't invalidate Dashboard's session consumers.
 */
export interface PlayerMinimizeContextValue {
  /**
   * True while the player is in in-window minimize mode: the Tauri main
   * window stays full size and only the mpv host shrinks to a small corner
   * of the WebView, letting the user navigate the rest of the app while
   * playback continues. Distinct from pop-out (`usePopOutPlayer().isPopOut`),
   * which floats the entire window.
   */
  isMinimized: boolean;
  /**
   * Enter in-window minimize mode. Drives the Rust `player_enter_minimize`
   * command (using the current `miniRect`) and flips `isMinimized` on
   * success. Caller is responsible for coordinating with pop-out — exit
   * pop-out first when both modes would otherwise overlap.
   */
  minimize: () => void;
  /** Exit in-window minimize mode and clear `isMinimized`. */
  restoreFromMinimize: () => void;
  /**
   * Current geometry for the in-window mini player: corner anchor, size,
   * and gutter padding. Persisted to `localStorage` under `mini-player.rect`
   * and seeded on mount via `loadPersistedMiniRect`. Drives the AppLayout
   * mask + Player.tsx miniContainer + Rust IPC.
   */
  miniRect: MiniRect;
  /**
   * Apply a partial update to `miniRect`. Merges with current state, saves
   * to localStorage, and — while minimized — re-fires
   * `player_enter_minimize` so the mpv host catches up to the new geometry.
   *
   * Updates while minimized do NOT use `flushSync` (no Dashboard cascade
   * since `isMinimized` is already true). Initial enter still does — see
   * `minimize` docblock.
   */
  updateMiniRect: (updates: Partial<MiniRect>) => void;
}

const PlayerSessionContext = createContext<PlayerSessionContextValue | null>(null);
const PlayerMinimizeContext = createContext<PlayerMinimizeContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  // Load the persisted size + corner once on mount. The default branch in
  // `loadPersistedMiniRect` covers first-run, corrupted-payload, and
  // out-of-range values. Synchronous read at init time avoids the one-frame
  // flash from a useEffect-driven hydrate.
  const [miniRect, setMiniRect] = useState<MiniRect>(() => loadPersistedMiniRect());

  // Keep a ref to the latest miniRect so `minimize()` always reads the
  // freshest geometry without participating in its useCallback deps (we
  // want minimize to keep stable identity for the button layer).
  const miniRectRef = useRef(miniRect);
  useEffect(() => {
    miniRectRef.current = miniRect;
  }, [miniRect]);

  // Mirror isMinimized for use inside `updateMiniRect` without re-creating
  // the callback every flip. Same reasoning as miniRectRef.
  const isMinimizedRef = useRef(isMinimized);
  useEffect(() => {
    isMinimizedRef.current = isMinimized;
  }, [isMinimized]);

  const play = useCallback((ratingKey: string, options?: PlayOptions) => {
    setSession({
      ratingKey,
      offset: options?.offset,
      watchTogether: options?.watchTogether,
    });
    // Starting a new session always lands in full player; any stale
    // minimize flag from a previous session is cleared here. The mpv
    // host re-init in ensure_init also passes a fresh inner rect, but
    // the Rust-side minimize state is per-app-process (not per-session)
    // and the React flag must mirror it.
    setIsMinimized(false);
  }, []);

  const stop = useCallback(() => {
    setSession(null);
    // Closing the player clears minimize too. The Rust side gets reset
    // via the existing `player_unload` -> `destroy` path; this just
    // keeps the React flag aligned for the next session.
    setIsMinimized(false);
  }, []);

  const replaceRatingKey = useCallback((ratingKey: string) => {
    setSession((prev) => (prev ? { ...prev, ratingKey, offset: undefined } : prev));
  }, []);

  const updateSession = useCallback((changes: Partial<PlayerSession>) => {
    setSession((prev) => (prev ? { ...prev, ...changes } : prev));
  }, []);

  // flushSync forces React to commit setIsMinimized SYNCHRONOUSLY before
  // returning. Without it, React batches the state update — by the time
  // the post-commit effect (below) fires the IPC, Rust resizes the mpv
  // host but the React tree is still showing full-chrome. The user sees
  // a transparent flash to desktop until React catches up.
  //
  // The PlayerContext split (prexu-ii3) now keeps Dashboard out of the
  // minimize re-render path, so flushSync only invalidates AppLayout +
  // Player.tsx — orders of magnitude cheaper than the prior Dashboard
  // cascade. Keeping it because the visual-flash rationale stands on
  // its own.
  const minimize = useCallback(() => {
    // In-window minimize is Windows-only IPC today (prexu-axj4.4) — the
    // UI affordance that calls this is already gated on
    // SUPPORTS_PLAYER_WINDOWING in Player.tsx, but guard here too so a
    // Linux-native session never invokes player_enter_minimize even if
    // some future call site forgets the UI-level gate.
    if (!SUPPORTS_PLAYER_WINDOWING) {
      logger.warn("player:minimize", "minimize ignored — windowing unsupported on this platform");
      return;
    }
    logger.info("player:minimize", "entering", miniRectRef.current);
    flushSync(() => {
      setIsMinimized(true);
    });
    // IPC fires from the useEffect below on the resulting commit.
  }, []);

  // NO optimistic flip on restore. Rust takes hundreds of ms to resize mpv
  // from small back to full (Win32 SetWindowPos), while React would
  // IMMEDIATELY swap AppLayout from corner-mask (mostly opaque) to
  // full-viewport-mask (entirely invisible). During that gap mpv is still
  // small in the corner; the rest of the WebView is transparent through to
  // the desktop.
  //
  // Waiting for the IPC means React stays in minimize-mode (corner mask
  // still opaque outside the corner) while Rust expands mpv. AppLayout
  // opaque covers mpv as it expands behind. Once Rust is done AND React
  // flips to full-player, AppLayout becomes invisible and mpv is already
  // full size — no transparent gap.
  //
  // Minimize direction still flips optimistically because that gap is
  // benign — the corner mask exposes a slice of the still-full mpv frame,
  // not desktop transparency.
  const restoreFromMinimize = useCallback(() => {
    // Mirrors the minimize() guard — isMinimized can only be true here if
    // minimize() already let it through, so this is belt-and-suspenders.
    if (!SUPPORTS_PLAYER_WINDOWING) {
      logger.warn("player:minimize", "restore ignored — windowing unsupported on this platform");
      setIsMinimized(false);
      return;
    }
    logger.info("player:minimize", "restoring");
    playerExitMinimize()
      .then(() => setIsMinimized(false))
      .catch((err) =>
        logger.error("player:minimize", "exit failed", String(err)),
      );
  }, []);

  // Pure reducer — no side effects inside the updater so the contract
  // works under StrictMode's intentional double-invocation in dev.
  // Persistence + IPC live in the effects below. Identity short-circuit
  // is preserved: when an interaction (resize-drag mouse-up landing on
  // the same corner with the same size) produces no actual change, we
  // return `prev` so React skips the re-render and the dep-driven
  // effects don't run.
  const updateMiniRect = useCallback((updates: Partial<MiniRect>) => {
    setMiniRect((prev) => {
      const next: MiniRect = { ...prev, ...updates };
      if (
        next.corner === prev.corner &&
        next.width === prev.width &&
        next.height === prev.height &&
        next.padding === prev.padding
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  // Persist any non-initial miniRect change. The initial state is
  // already seeded from localStorage by loadPersistedMiniRect, so
  // writing it back on mount is redundant — skip the first commit.
  //
  // The write is debounced 300ms trailing so drag/resize ticks at ~33ms
  // do not hammer localStorage on every geometry IPC cycle (prexu-bgz.11).
  // In-memory state updates remain immediate; only the storage write is
  // deferred.
  const skipFirstSaveRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      logger.trace("player:minimize", "persisting miniRect to storage", miniRect);
      saveMiniRect(miniRect);
    }, 300);
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [miniRect]);

  // Track the previous isMinimized value so the geometry effect below can
  // distinguish the false→true transition from per-tick rect updates.
  const prevIsMinimizedRef = useRef(false);

  // Sync the mpv host geometry whenever we are minimized. Covers both
  // (a) the false → true transition triggered by `minimize()` and
  // (b) rect updates while minimized (drag, resize handle, corner snap).
  //
  // (a) uses `playerEnterMinimize` which emits busy/ready so
  // useTransparentWindow can shield the body during the mode change.
  //
  // (b) uses `playerUpdateMiniGeometry` — same geometry work but WITHOUT
  // busy/ready. Per-tick drag/resize ticks are not mode transitions; emitting
  // busy/ready on each 33ms tick caused body transparency to thrash (prexu-anp).
  //
  // The exit IPC stays in `restoreFromMinimize` because it must await
  // before flipping `isMinimized` to false (see that callback's docblock
  // for the visual-flash rationale).
  useEffect(() => {
    if (!isMinimized) {
      prevIsMinimizedRef.current = false;
      return;
    }
    // Belt-and-suspenders: isMinimized can only be true if minimize()
    // already gated on SUPPORTS_PLAYER_WINDOWING, but guard the IPC call
    // itself too so a future code path setting isMinimized directly can't
    // reach an unregistered command on Linux native.
    if (!SUPPORTS_PLAYER_WINDOWING) {
      return;
    }
    const isTransition = !prevIsMinimizedRef.current;
    prevIsMinimizedRef.current = true;

    if (isTransition) {
      // false → true: genuine minimize entry. Use enter_minimize so the
      // busy/ready transparency protocol runs (prexu-7d3).
      logger.debug("player:minimize", "entering minimize via IPC", miniRect);
      playerEnterMinimize(
        miniRect.width,
        miniRect.height,
        miniRect.padding,
        miniRect.corner,
      ).catch((err) => {
        logger.error("player:minimize", "enter failed", String(err));
        setIsMinimized(false);
      });
    } else {
      // Already minimized — geometry-only update (drag or resize tick).
      // No busy/ready so body transparency is not disturbed.
      logger.debug("player:minimize", "geometry update (already minimized)", miniRect);
      playerUpdateMiniGeometry(
        miniRect.width,
        miniRect.height,
        miniRect.padding,
        miniRect.corner,
      ).catch((err) => {
        logger.warn("player:minimize", "geometry update failed", String(err));
      });
    }
  }, [isMinimized, miniRect]);

  // Memoize each slice independently. minimize-toggle invalidates only
  // the minimize value; session consumers see stable identity and skip
  // their re-render. play/stop reset isMinimized internally, so both
  // slices change in that flow — expected.
  const sessionValue = useMemo<PlayerSessionContextValue>(
    () => ({
      session,
      play,
      stop,
      replaceRatingKey,
      updateSession,
    }),
    [session, play, stop, replaceRatingKey, updateSession],
  );

  const minimizeValue = useMemo<PlayerMinimizeContextValue>(
    () => ({
      isMinimized,
      minimize,
      restoreFromMinimize,
      miniRect,
      updateMiniRect,
    }),
    [isMinimized, minimize, restoreFromMinimize, miniRect, updateMiniRect],
  );

  return (
    <PlayerSessionContext.Provider value={sessionValue}>
      <PlayerMinimizeContext.Provider value={minimizeValue}>
        {children}
      </PlayerMinimizeContext.Provider>
    </PlayerSessionContext.Provider>
  );
}

/**
 * Access the player session controls. Throws if used outside PlayerProvider.
 *
 * Named `usePlayerSession` rather than `usePlayer` to avoid clashing with
 * the existing playback-engine hook in src/hooks/usePlayer.ts. This hook
 * is for opening/closing the overlay; that hook is for driving libmpv
 * once the overlay is open.
 *
 * Consumers of this hook re-render only on session changes. Minimize /
 * miniRect updates are isolated on a separate context — see
 * `usePlayerMinimize`.
 */
export function usePlayerSession(): PlayerSessionContextValue {
  const ctx = useContext(PlayerSessionContext);
  if (!ctx) {
    throw new Error("usePlayerSession must be used within a PlayerProvider");
  }
  return ctx;
}

/**
 * Access in-window minimize state + mini-player geometry. Throws if used
 * outside PlayerProvider.
 *
 * Kept on its own context so that frequent minimize toggles / drag-resize
 * updates don't cascade-invalidate Dashboard or other session-only
 * consumers (prexu-ii3).
 */
export function usePlayerMinimize(): PlayerMinimizeContextValue {
  const ctx = useContext(PlayerMinimizeContext);
  if (!ctx) {
    throw new Error("usePlayerMinimize must be used within a PlayerProvider");
  }
  return ctx;
}

// Re-export the default for callers that want to seed component-level
// state without depending on the helper module directly.
export { DEFAULT_MINI_RECT };
export type { MiniCorner, MiniRect };
