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
  loadNextEpisode: (ratingKey: string, title: string, mediaType?: "movie" | "episode") => void;
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

  // Only actual EOF advances a session. Pausing or seeking near the end
  // must not change what everyone is watching.
  const { subscribeToEof } = player;
  useEffect(() => {
    if (!isInSession || !isHost) return;
    return subscribeToEof(() => setShowNextEpisodePrompt(true));
  }, [isInSession, isHost, subscribeToEof]);

  const loadNextEpisode = useCallback(
    (ratingKey: string, title: string, mediaType: "movie" | "episode" = "episode") => {
      if (!isInSession || !isHost) return;

      // Send new_media to all participants
      watchSync.send({
        type: "new_media",
        media_rating_key: ratingKey,
        media_title: title,
        media_type: mediaType,
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
