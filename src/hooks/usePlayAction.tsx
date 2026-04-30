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

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import { getItemMetadata } from "../services/plex-library";
import ResumePopover from "../components/ResumePopover";
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
  const navigate = useNavigate();
  const { server } = useAuth();
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  const getPlayHandler = useCallback(
    (item: PlexMediaItem): ((e: React.MouseEvent) => void) | undefined => {
      if (!PLAYABLE_TYPES.has(item.type)) return undefined;

      return (e: React.MouseEvent) => {
        e.stopPropagation();

        if (!server) {
          navigate(`/play/${item.ratingKey}`);
          return;
        }

        const position = { x: e.clientX, y: e.clientY };
        const cachedOffset =
          (item as { viewOffset?: number }).viewOffset ?? 0;

        // Fast path: dashboard/onDeck items already carry viewOffset, so
        // we can render the popover instantly with no network round trip.
        if (cachedOffset > 0) {
          setPrompt({
            kind: "resume",
            ratingKey: item.ratingKey,
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
        setPrompt({ kind: "checking", ratingKey: item.ratingKey, position });

        getItemMetadata<PlexMediaItem>(
          server.uri,
          server.accessToken,
          item.ratingKey,
        )
          .then((fullItem) => {
            const viewOffset =
              (fullItem as { viewOffset?: number }).viewOffset ?? 0;

            // Race-guard: another item may have been clicked in the
            // meantime; only update state if we're still showing this one.
            setPrompt((prev) => {
              if (prev?.ratingKey !== item.ratingKey) return prev;
              if (viewOffset > 0) {
                return {
                  kind: "resume",
                  ratingKey: item.ratingKey,
                  viewOffset,
                  position,
                };
              }
              return null;
            });

            if (viewOffset === 0) {
              navigate(`/play/${item.ratingKey}`);
            }
          })
          .catch(() => {
            setPrompt((prev) =>
              prev?.ratingKey === item.ratingKey ? null : prev,
            );
            navigate(`/play/${item.ratingKey}`);
          });
      };
    },
    [navigate, server],
  );

  let playOverlay: React.ReactNode = null;
  if (prompt?.kind === "resume") {
    playOverlay = (
      <ResumePopover
        viewOffset={prompt.viewOffset}
        anchorPosition={prompt.position}
        onResume={() => {
          navigate(`/play/${prompt.ratingKey}`);
          setPrompt(null);
        }}
        onPlayFromBeginning={() => {
          navigate(`/play/${prompt.ratingKey}?offset=0`);
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
