/**
 * Shared hook that provides a play-button click handler for PosterCard.
 *
 * - Returns `getPlayHandler(item)` — produces a click handler for playable items
 *   (movies, episodes), or `undefined` for non-playable types (show, season, artist).
 * - On click, fetches the item's full metadata to check for `viewOffset`.
 * - If `viewOffset > 0` (partially watched), shows a ResumePopover with
 *   "Resume from XX:XX" and "Play from Beginning" options.
 * - If no viewOffset, navigates directly to the player.
 * - `playOverlay` renders the ResumePopover when visible — include it in JSX.
 */

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import { getItemMetadata } from "../services/plex-library";
import ResumePopover from "../components/ResumePopover";
import type { PlexMediaItem } from "../types/library";

interface ResumeState {
  ratingKey: string;
  viewOffset: number;
  position: { x: number; y: number };
}

interface UsePlayActionResult {
  /** Returns a click handler for playable items, or undefined for non-playable types */
  getPlayHandler: (item: PlexMediaItem) => ((e: React.MouseEvent) => void) | undefined;
  /** Render this in your JSX to show the ResumePopover when needed */
  playOverlay: React.ReactNode;
}

/** Item types that can be played directly */
const PLAYABLE_TYPES = new Set(["movie", "episode"]);

export function usePlayAction(): UsePlayActionResult {
  const navigate = useNavigate();
  const { server } = useAuth();
  const [resumeState, setResumeState] = useState<ResumeState | null>(null);

  const getPlayHandler = useCallback(
    (item: PlexMediaItem): ((e: React.MouseEvent) => void) | undefined => {
      if (!PLAYABLE_TYPES.has(item.type)) return undefined;

      return (e: React.MouseEvent) => {
        e.stopPropagation();

        if (!server) {
          navigate(`/play/${item.ratingKey}`);
          return;
        }

        // Capture click position before the async call
        const position = { x: e.clientX, y: e.clientY };

        // Fetch full metadata to get the real viewOffset
        getItemMetadata<PlexMediaItem>(
          server.uri,
          server.accessToken,
          item.ratingKey,
        )
          .then((fullItem) => {
            const viewOffset = (fullItem as { viewOffset?: number }).viewOffset ?? 0;

            if (viewOffset > 0) {
              // Show resume popover
              setResumeState({
                ratingKey: item.ratingKey,
                viewOffset,
                position,
              });
            } else {
              // No resume position — play directly
              navigate(`/play/${item.ratingKey}`);
            }
          })
          .catch(() => {
            // If metadata fetch fails, just play directly
            navigate(`/play/${item.ratingKey}`);
          });
      };
    },
    [navigate, server],
  );

  const playOverlay = resumeState ? (
    <ResumePopover
      viewOffset={resumeState.viewOffset}
      anchorPosition={resumeState.position}
      onResume={() => {
        navigate(`/play/${resumeState.ratingKey}`);
        setResumeState(null);
      }}
      onPlayFromBeginning={() => {
        navigate(`/play/${resumeState.ratingKey}?offset=0`);
        setResumeState(null);
      }}
      onClose={() => setResumeState(null)}
    />
  ) : null;

  return { getPlayHandler, playOverlay };
}
