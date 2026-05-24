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
import { playerEnterMinimize, playerExitMinimize } from "../services/player";
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

export interface PlayerContextValue {
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
  /**
   * True while the player is in in-window minimize mode (prexu-7il.2):
   * the Tauri main window stays full size and only the mpv host shrinks
   * to a small corner of the WebView, letting the user navigate the
   * rest of the app while playback continues. Distinct from pop-out
   * (`usePopOutPlayer().isPopOut`), which floats the entire window.
   */
  isMinimized: boolean;
  /**
   * Enter in-window minimize mode. Drives the Rust `player_enter_minimize`
   * command (using the current `miniRect`) and flips `isMinimized` on
   * success. Caller is responsible for coordinating with pop-out — the
   * button-layer integration in 7il.4 exits pop-out first when both modes
   * would otherwise overlap.
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

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  // prexu-7il.5 + 7il.7: load the persisted size + corner once on mount.
  // The default branch in `loadPersistedMiniRect` covers first-run,
  // corrupted-payload, and out-of-range values. Synchronous read at
  // init time avoids the one-frame flash from a useEffect-driven hydrate.
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
  // flushSync blocks the event loop for the commit duration; on the
  // Dashboard route that's ~1s. The structural fix is to split
  // PlayerContext so isMinimized changes don't invalidate Dashboard's
  // tree (prexu-ii3) — flushSync is the tactical bridge until then.
  const minimize = useCallback(() => {
    logger.info("player:minimize", "entering", miniRectRef.current);
    flushSync(() => {
      setIsMinimized(true);
    });
    // IPC fires from the useEffect below on the resulting commit.
  }, []);

  // prexu-7cb: NO optimistic flip on restore. Symmetric reasoning to
  // minimize is wrong here because Rust takes hundreds of ms to resize
  // mpv from small back to full (Win32 SetWindowPos), while React
  // would IMMEDIATELY swap AppLayout from corner-mask (mostly opaque)
  // to full-viewport-mask (entirely invisible). During that gap mpv is
  // still small in the corner; the rest of the WebView is transparent
  // through to the desktop. The result is a visible transparent flash
  // for the whole duration of Rust's resize.
  //
  // Waiting for the IPC means React stays in minimize-mode (corner mask
  // still opaque outside the corner) while Rust expands mpv. AppLayout
  // opaque covers mpv as it expands behind. Once Rust is done AND
  // React flips to full-player, AppLayout becomes invisible and mpv is
  // already full size and visible everywhere — no transparent gap.
  //
  // (Minimize direction still flips optimistically because that gap is
  // benign — the corner mask exposes a slice of the still-full mpv
  // frame, no desktop transparency.)
  const restoreFromMinimize = useCallback(() => {
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
  const skipFirstSaveRef = useRef(true);
  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    saveMiniRect(miniRect);
  }, [miniRect]);

  // Sync the mpv host geometry whenever we are minimized. Covers both
  // (a) the false → true transition triggered by `minimize()` and
  // (b) rect updates while minimized (drag, resize handle, corner snap).
  // The exit IPC stays in `restoreFromMinimize` because it must await
  // before flipping `isMinimized` to false (see that callback's docblock
  // for the visual-flash rationale).
  useEffect(() => {
    if (!isMinimized) return;
    logger.debug("player:minimize", "applying mini rect via effect", miniRect);
    playerEnterMinimize(
      miniRect.width,
      miniRect.height,
      miniRect.padding,
      miniRect.corner,
    ).catch((err) => {
      logger.error("player:minimize", "enter failed", String(err));
      setIsMinimized(false);
    });
  }, [isMinimized, miniRect]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      session,
      play,
      stop,
      replaceRatingKey,
      updateSession,
      isMinimized,
      minimize,
      restoreFromMinimize,
      miniRect,
      updateMiniRect,
    }),
    [
      session,
      play,
      stop,
      replaceRatingKey,
      updateSession,
      isMinimized,
      minimize,
      restoreFromMinimize,
      miniRect,
      updateMiniRect,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

/**
 * Access the player session controls. Throws if used outside PlayerProvider.
 *
 * Named `usePlayerSession` rather than `usePlayer` to avoid clashing with
 * the existing playback-engine hook in src/hooks/usePlayer.ts. This hook
 * is for opening/closing the overlay; that hook is for driving libmpv
 * once the overlay is open.
 */
export function usePlayerSession(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error("usePlayerSession must be used within a PlayerProvider");
  }
  return ctx;
}

// Re-export the default for callers that want to seed component-level
// state without depending on the helper module directly.
export { DEFAULT_MINI_RECT };
export type { MiniCorner, MiniRect };
