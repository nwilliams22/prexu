/**
 * Handles episode transitions and next-episode prompts in Watch Together sessions.
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { watchSync } from "../../services/watch-sync";
import type { UsePlayerResult } from "../usePlayer";

export interface UseRemoteMediaSwitchResult {
  showNextEpisodePrompt: boolean;
  nextEpisodeInfo: { ratingKey: string; title: string } | null;
  loadNextEpisode: (ratingKey: string, title: string) => void;
  dismissNextEpisodePrompt: () => void;
}

export function useRemoteMediaSwitch(
  player: UsePlayerResult,
  isInSession: boolean,
  isHost: boolean,
  sessionId: string | null
): UseRemoteMediaSwitchResult {
  const navigate = useNavigate();

  const [showNextEpisodePrompt, setShowNextEpisodePrompt] = useState(false);
  const [nextEpisodeInfo, setNextEpisodeInfo] = useState<{
    ratingKey: string;
    title: string;
  } | null>(null);

  // Listen for remote new_media events
  useEffect(() => {
    if (!isInSession) return;

    const unsubNewMedia = watchSync.on(
      "new_media",
      (data: {
        media_rating_key: string;
        media_title: string;
        from_user: string;
      }) => {
        // Navigate to the new media, keeping session context
        navigate(
          `/play/${data.media_rating_key}?session=${sessionId}&host=${isHost}`,
          { replace: true }
        );
      }
    );

    return () => {
      unsubNewMedia();
    };
  }, [isInSession, sessionId, isHost, navigate]);

  // Detect episode end for next-episode prompt (host only)
  useEffect(() => {
    if (!isInSession || !isHost) return;
    if (player.duration <= 0) return;

    // Check if we're near the end (within 1 second)
    if (
      player.currentTime > 0 &&
      player.duration - player.currentTime < 1 &&
      !player.isPlaying
    ) {
      setShowNextEpisodePrompt(true);
    }
  }, [
    player.currentTime,
    player.duration,
    player.isPlaying,
    isInSession,
    isHost,
  ]);

  const loadNextEpisode = useCallback(
    (ratingKey: string, title: string) => {
      if (!isInSession) return;

      // Send new_media to all participants
      watchSync.send({
        type: "new_media",
        media_rating_key: ratingKey,
        media_title: title,
        media_type: "episode",
      });

      // Navigate locally
      navigate(`/play/${ratingKey}?session=${sessionId}&host=${isHost}`, {
        replace: true,
      });

      setShowNextEpisodePrompt(false);
      setNextEpisodeInfo(null);
    },
    [isInSession, sessionId, isHost, navigate]
  );

  const dismissNextEpisodePrompt = useCallback(() => {
    setShowNextEpisodePrompt(false);
    setNextEpisodeInfo(null);
  }, []);

  return {
    showNextEpisodePrompt,
    nextEpisodeInfo,
    loadNextEpisode,
    dismissNextEpisodePrompt,
  };
}
