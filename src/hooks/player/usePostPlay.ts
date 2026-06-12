/**
 * PostPlay flow hook — owns end-of-playback continuation behavior.
 *
 * Owns:
 *   - `showPostPlay` + `postPlayShownRef` (overlay visibility latch).
 *   - `postPlayDetail` enriched-metadata state + the fetch effect.
 *   - The EOF subscription effect (dispatched through
 *     `player.subscribeToEof` — the backend picks between mpv
 *     `player://eof` and `<video>.ended`).
 *   - The ratingKey reset effect (clears showPostPlay + detail on swap).
 *   - The mini-mode PostPlay handoff (autoplay → fire next, else
 *     restore-from-minimize so the user can see the overlay).
 *   - `nextQueueItem` derivation.
 *
 * Critical invariants:
 *   - EOF with `!hasNextItem && !wtInSession` → calls `onExit` so the
 *     user lands back on the dashboard instead of a paused-at-EOF black
 *     frame.
 *   - PostPlay open pauses the underlying player synchronously via
 *     `player.pause()` (backend dispatches to mpv or `<video>`).
 *   - WT-in-session never fires PostPlay; the host drives flow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UsePlayerResult } from "../usePlayer";
import type { PlexEpisode, PlexMediaItem } from "../../types/library";
import type { PlaybackQueue, QueueItem } from "../../types/queue";
import { getItemMetadata } from "../../services/plex-library";
import { minimizedPostPlayAction } from "../../pages/player-postplay-gate";
import { logger } from "../../services/logger";

export interface UsePostPlayArgs {
  player: UsePlayerResult;
  queue: PlaybackQueue;
  ratingKey: string;
  itemType: string;
  hasNextItem: boolean;
  wtInSession: boolean;
  isMinimized: boolean;
  autoPlayEnabled: boolean;
  /**
   * Server connection (uri + accessToken). Structural type matches the
   * other player hooks (useEpisodeNavigation, useNextEpisodeDetection,
   * useShowCreditsLength) so a ServerData or PlexServer can be passed.
   */
  server: { uri: string; accessToken: string } | null;
  /** Called when the user (or autoplay) advances to the next item. Today
   *  this is the parent's `handleNextEpisode`. */
  onAdvanceNext: () => void;
  /** Called when the user explicitly stops (PostPlay Stop, or EOF-with-no-
   *  continuation auto-exit). Wired to lifecycle.exit. */
  onExit: () => void;
  /** Called to restore from minimize (for the no-autoplay mini-mode handoff). */
  onRestoreFromMinimize: () => void;
}

export interface UsePostPlayResult {
  /** True when the PostPlay overlay should mount. */
  showPostPlay: boolean;
  /** Enriched metadata for next-up (synopsis, cast, etc.). Null until fetch lands. */
  postPlayDetail: PlexEpisode | PlexMediaItem | null;
  /** Next item from queue (for the PostPlayScreen hero). Null when no next. */
  nextQueueItem: QueueItem | null;
  /** Click handler: PostPlay → "Play Now" → advance. */
  onPlayNext: () => void;
  /** Click handler: PostPlay → "Stop" → close player. */
  onStop: () => void;
}

export function usePostPlay({
  player,
  queue,
  ratingKey,
  itemType,
  hasNextItem,
  wtInSession,
  isMinimized,
  autoPlayEnabled,
  server,
  onAdvanceNext,
  onExit,
  onRestoreFromMinimize,
}: UsePostPlayArgs): UsePostPlayResult {
  const [showPostPlay, setShowPostPlay] = useState(false);
  const postPlayShownRef = useRef(false);

  // Enriched metadata for the next item — fetched when PostPlay is about to
  // show so we can render synopsis, air date, watched chip, and credits in
  // the upper-half overlay. Null until the fetch lands; the overlay still
  // renders immediately with the lightweight QueueItem fields and fades the
  // extras in when this populates. Cleared on ratingKey change.
  const [postPlayDetail, setPostPlayDetail] = useState<
    PlexEpisode | PlexMediaItem | null
  >(null);

  // Keep refs to the latest callbacks so the EOF effect doesn't need to
  // re-subscribe (and the listener doesn't capture a stale closure) on
  // every render. The EOF effect re-binds only when its true dependencies
  // — hasNextItem, wtInSession, itemType, queue fields — actually change.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // ── EOF subscription ────────────────────────────────────────────────────
  // player.subscribeToEof dispatches to the correct backend (mpv
  // player://eof on native, video.addEventListener("ended") on HTML5).
  // The pause-on-PostPlay call below is similarly dispatched via
  // player.pause(); this hook does not touch videoRef directly.
  useEffect(() => {
    const handleEnded = () => {
      // hasNextItem encodes "real successor exists":
      //  - episode with queue/episode-nav next, OR
      //  - any type playing from a user-built queue with another item next.
      // A standalone movie should NOT pop PostPlay against a stale auto-
      // populated episode queue, which is why we distinguish queue.source.
      logger.debug("postplay", "EOF reached", {
        itemType,
        hasNextItem,
        queueSource: queue.source,
        queueCurrentIndex: queue.currentIndex,
        queueLength: queue.items.length,
        wtInSession,
      });
      if (hasNextItem && !wtInSession && !postPlayShownRef.current) {
        postPlayShownRef.current = true;
        // Pause the underlying player synchronously with showing the overlay.
        // Two reasons: (a) on native, mpv with keep-open=always usually stops
        // at EOF but the rare path where it doesn't (or where some other code
        // re-issues loadfile) leaks audio/video under the overlay; (b) on
        // HTML5, browsers may fire `ended` then auto-restart on certain
        // codecs. Idempotent — pausing an already-paused player is a no-op.
        player.pause();
        setShowPostPlay(true);
        return;
      }
      // No continuation path: not in WT (host drives flow there) and either
      // a movie or a final episode. Exit the player immediately — the
      // user has no next item and nothing to interact with on a paused-
      // at-EOF black frame.
      if (!hasNextItem && !wtInSession) {
        logger.info("player", "EOF with no continuation — exiting player");
        onExitRef.current();
      }
    };
    return player.subscribeToEof(handleEnded);
  }, [
    player,
    hasNextItem,
    wtInSession,
    itemType,
    queue.source,
    queue.currentIndex,
    queue.items.length,
  ]);

  // Reset post-play state when ratingKey changes
  useEffect(() => {
    postPlayShownRef.current = false;
    setShowPostPlay(false);
    setPostPlayDetail(null);
  }, [ratingKey]);

  const onPlayNext = useCallback(() => {
    setShowPostPlay(false);
    onAdvanceNext();
  }, [onAdvanceNext]);

  // Stop on PostPlay = the user's intent is "I'm done watching" — leave the
  // player route entirely (same as the bottom-bar Stop button + ESC). Just
  // hiding the overlay would leave the user staring at a paused black frame
  // since the underlying mpv is at EOF; that's what looked like a "page
  // reload" to the user (the URL didn't change, they just went from overlay
  // to player chrome). Reset postPlayShownRef so a fresh navigation back
  // into this episode can re-trigger PostPlay later.
  const onStop = useCallback(() => {
    setShowPostPlay(false);
    postPlayShownRef.current = false;
    onExitRef.current();
  }, []);

  // PostPlay handoff for mini mode. The full <PostPlayScreen> is in the
  // post-early-return branch of Player.tsx, so when isMinimized is true
  // it never mounts and its 10s countdown never fires onPlayNext — the
  // user sees a black frame at EOF instead of the next episode. Bridge
  // that gap here: autoplay-on → fire next directly so playback continues
  // seamlessly in mini; autoplay-off → restore to fullscreen so the user
  // can see the Play Now / Stop buttons and decide.
  // minimizedPostPlayAction's "none" return covers every non-minimized
  // path so the regular flow is unaffected.
  useEffect(() => {
    const action = minimizedPostPlayAction({
      isMinimized,
      showPostPlay,
      autoPlayEnabled,
    });
    if (action === "none") return;
    logger.info("postplay", "mini-mode handoff", { action });
    if (action === "fire-next") {
      onPlayNext();
    } else {
      onRestoreFromMinimize();
    }
  }, [
    isMinimized,
    showPostPlay,
    autoPlayEnabled,
    onPlayNext,
    onRestoreFromMinimize,
  ]);

  // Get the next queue item for the post-play screen
  const nextQueueItem = useMemo(() => {
    const { items, currentIndex } = queue;
    const nextIdx = currentIndex + 1;
    return nextIdx < items.length ? items[nextIdx] : null;
  }, [queue]);

  // Fetch enriched metadata for the next item when PostPlay is about to show
  // so synopsis/air date/cast/director/watched-chip can populate the upper-
  // half overlay. The overlay still renders immediately from the lightweight
  // QueueItem; this just lights up the richer fields when they arrive.
  const nextRatingKeyForFetch =
    showPostPlay && nextQueueItem ? nextQueueItem.ratingKey : null;
  useEffect(() => {
    if (!nextRatingKeyForFetch || !server) return;
    let cancelled = false;
    getItemMetadata<PlexMediaItem>(
      server.uri,
      server.accessToken,
      nextRatingKeyForFetch,
    )
      .then((detail) => {
        if (cancelled) return;
        setPostPlayDetail(detail);
      })
      .catch((err) => {
        // Best-effort — PostPlay still works without the enriched fields.
        logger.warn("postplay", "next-item metadata fetch failed", String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [nextRatingKeyForFetch, server]);

  return {
    showPostPlay,
    postPlayDetail,
    nextQueueItem,
    onPlayNext,
    onStop,
  };
}
