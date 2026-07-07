/**
 * Shared hook that provides a play-button click handler for PosterCard.
 *
 * - Returns `getPlayHandler(item)` — produces a click handler for playable items
 *   (movies, episodes), or `undefined` for non-playable types (show, season, artist).
 * - Fast path: when the cached `item.viewOffset` is already populated
 *   (true for onDeck / recently-added items), the ResumePopover shows
 *   instantly with no network round trip.
 * - Slow path: when no cached offset is present, a small loading popover
 *   appears immediately at the click point while metadata is fetched, so
 *   the user gets feedback within one frame instead of staring at a blank
 *   screen for 1-2 s.
 * - `playOverlay` renders whichever popover is active — include it in JSX.
 */

import { useState, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";
import { usePlayerSession } from "../contexts/PlayerContext";
import { getItemMetadata } from "../services/plex-library";
import ResumePopover from "../components/ResumePopover";
import { logger } from "../services/logger";
import type { PlexMediaItem } from "../types/library";

type PromptState =
  | {
      kind: "checking";
      ratingKey: string;
      position: { x: number; y: number };
    }
  | {
      kind: "resume";
      ratingKey: string;
      viewOffset: number;
      position: { x: number; y: number };
    };

interface UsePlayActionResult {
  /** Returns a click handler for playable items, or undefined for non-playable types */
  getPlayHandler: (item: PlexMediaItem) => ((e: React.MouseEvent) => void) | undefined;
  /** Render this in your JSX to show the active popover when needed */
  playOverlay: React.ReactNode;
}

/** Item types that can be played directly */
const PLAYABLE_TYPES = new Set(["movie", "episode"]);

export function usePlayAction(): UsePlayActionResult {
  const { play } = usePlayerSession();
  const { server } = useAuth();
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  // getPlayHandler(item) used to return a BRAND NEW closure on every call —
  // even though the hook's own useCallback identity was stable, every list
  // render site does `onPlay={getPlayHandler(item)}`, so PosterCard always
  // saw a "changed" onPlay prop and React.memo could never skip it
  // (prexu-0szx.13). Cache one handler PER ratingKey instead: the returned
  // closure reads the item from `itemsRef` at click time (never stale) and
  // `play`/`server` from refs, so its own identity never needs to change —
  // only the ratingKey determines which cached handler is returned.
  const itemsRef = useRef(new Map<string, PlexMediaItem>());
  const handlersRef = useRef(new Map<string, (e: React.MouseEvent) => void>());
  const playRef = useRef(play);
  playRef.current = play;
  const serverRef = useRef(server);
  serverRef.current = server;

  const getPlayHandler = useCallback(
    (item: PlexMediaItem): ((e: React.MouseEvent) => void) | undefined => {
      if (!PLAYABLE_TYPES.has(item.type)) return undefined;

      // Keep the latest item data warm so the cached handler (created once
      // below) always reads fresh viewOffset/ratingKey at click time.
      itemsRef.current.set(item.ratingKey, item);

      const cached = handlersRef.current.get(item.ratingKey);
      if (cached) return cached;

      const handler = (e: React.MouseEvent) => {
        e.stopPropagation();

        const current = itemsRef.current.get(item.ratingKey) ?? item;
        const currentServer = serverRef.current;
        const currentPlay = playRef.current;

        if (!currentServer) {
          currentPlay(current.ratingKey);
          return;
        }

        const position = { x: e.clientX, y: e.clientY };
        const cachedOffset =
          (current as { viewOffset?: number }).viewOffset ?? 0;

        // Fast path: dashboard/onDeck items already carry viewOffset, so
        // we can render the popover instantly with no network round trip.
        if (cachedOffset > 0) {
          // prexu-0fwh: numeric provenance of the label the user reads, so a
          // future hardware round can pin which layer is stale by value. The
          // offset comes straight off the (live) item prop the caller passed.
          logger.debug("playback", "resume popover opened", {
            ratingKey: current.ratingKey,
            viewOffset: cachedOffset,
            source: "cached-item",
          });
          setPrompt({
            kind: "resume",
            ratingKey: current.ratingKey,
            viewOffset: cachedOffset,
            position,
          });
          return;
        }

        // Slow path: no cached offset. Show the loading popover at the
        // click point so the user sees instant feedback, then verify with
        // a metadata fetch. The actual resume position used at playback
        // time comes from the FRESH metadata fetched inside initPlayback,
        // so a slightly stale cache only affects the popover label.
        setPrompt({ kind: "checking", ratingKey: current.ratingKey, position });

        getItemMetadata<PlexMediaItem>(
          currentServer.uri,
          currentServer.accessToken,
          current.ratingKey,
        )
          .then((fullItem) => {
            const viewOffset =
              (fullItem as { viewOffset?: number }).viewOffset ?? 0;

            // Race-guard: another item may have been clicked in the
            // meantime; only update state if we're still showing this one.
            setPrompt((prev) => {
              if (prev?.ratingKey !== current.ratingKey) return prev;
              if (viewOffset > 0) {
                // prexu-0fwh: same provenance log as the fast path, but the
                // offset here came from a fresh metadata fetch, not the prop.
                logger.debug("playback", "resume popover opened", {
                  ratingKey: current.ratingKey,
                  viewOffset,
                  source: "metadata-fetch",
                });
                return {
                  kind: "resume",
                  ratingKey: current.ratingKey,
                  viewOffset,
                  position,
                };
              }
              return null;
            });

            if (viewOffset === 0) {
              playRef.current(current.ratingKey);
            }
          })
          .catch(() => {
            setPrompt((prev) =>
              prev?.ratingKey === current.ratingKey ? null : prev,
            );
            playRef.current(current.ratingKey);
          });
      };

      handlersRef.current.set(item.ratingKey, handler);
      return handler;
    },
    [],
  );

  let playOverlay: React.ReactNode = null;
  if (prompt?.kind === "resume") {
    playOverlay = (
      <ResumePopover
        viewOffset={prompt.viewOffset}
        anchorPosition={prompt.position}
        onResume={() => {
          play(prompt.ratingKey);
          setPrompt(null);
        }}
        onPlayFromBeginning={() => {
          play(prompt.ratingKey, { offset: 0 });
          setPrompt(null);
        }}
        onClose={() => setPrompt(null)}
      />
    );
  } else if (prompt?.kind === "checking") {
    playOverlay = (
      <div
        role="status"
        aria-label="Loading playback options"
        style={{
          position: "fixed",
          left: prompt.position.x,
          top: prompt.position.y,
          zIndex: 1200,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "10px 14px",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
          animation: "popIn 0.12s ease-out",
          transformOrigin: "top left",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.85rem",
          color: "var(--text-secondary)",
          pointerEvents: "none",
        }}
      >
        <div className="loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
        <span>Loading…</span>
      </div>
    );
  }

  return { getPlayHandler, playOverlay };
}
