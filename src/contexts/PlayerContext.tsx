import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

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

interface PlayerContextValue {
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

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PlayerSession | null>(null);

  const play = useCallback((ratingKey: string, options?: PlayOptions) => {
    setSession({
      ratingKey,
      offset: options?.offset,
      watchTogether: options?.watchTogether,
    });
  }, []);

  const stop = useCallback(() => {
    setSession(null);
  }, []);

  const replaceRatingKey = useCallback((ratingKey: string) => {
    setSession((prev) => (prev ? { ...prev, ratingKey, offset: undefined } : prev));
  }, []);

  const updateSession = useCallback((changes: Partial<PlayerSession>) => {
    setSession((prev) => (prev ? { ...prev, ...changes } : prev));
  }, []);

  const value = useMemo<PlayerContextValue>(
    () => ({ session, play, stop, replaceRatingKey, updateSession }),
    [session, play, stop, replaceRatingKey, updateSession],
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
