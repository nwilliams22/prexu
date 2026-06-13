/**
 * Fetches previous/next episodes for the current media item.
 * Provides navigation callbacks for episode transitions.
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getItemMetadata, getNextEpisode, getPreviousEpisode } from "../../services/plex-library";
import type { PlexEpisode, PlexMediaItem } from "../../types/library";

export interface EpisodeNavigationResult {
  handleNextEpisode: (() => void) | undefined;
  handlePrevEpisode: (() => void) | undefined;
}

export function useEpisodeNavigation(
  server: { uri: string; accessToken: string } | null,
  ratingKey: string | undefined,
  itemType: string | undefined,
): EpisodeNavigationResult {
  const navigate = useNavigate();
  const [prevEp, setPrevEp] = useState<PlexEpisode | null>(null);
  const [nextEp, setNextEp] = useState<PlexEpisode | null>(null);

  useEffect(() => {
    if (!server || !ratingKey || itemType !== "episode") {
      setPrevEp(null);
      setNextEp(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const item = await getItemMetadata<PlexMediaItem>(
          server.uri,
          server.accessToken,
          ratingKey,
        );
        if (cancelled || item.type !== "episode") return;
        const ep = item as PlexEpisode;
        const [prev, next] = await Promise.all([
          getPreviousEpisode(server.uri, server.accessToken, ep),
          getNextEpisode(server.uri, server.accessToken, ep),
        ]);
        if (cancelled) return;
        setPrevEp(prev);
        setNextEp(next);
      } catch {
        // Non-critical
      }
    })();
    return () => { cancelled = true; };
  }, [server, ratingKey, itemType]);

  // Stable identities (changing only when the adjacent episode actually
  // changes) so downstream useCallback/React.memo consumers don't churn
  // on every render of the owning component.
  const goNext = useCallback(() => {
    if (nextEp) navigate(`/play/${nextEp.ratingKey}`);
  }, [nextEp, navigate]);
  const goPrev = useCallback(() => {
    if (prevEp) navigate(`/play/${prevEp.ratingKey}`);
  }, [prevEp, navigate]);

  return {
    handleNextEpisode: nextEp ? goNext : undefined,
    handlePrevEpisode: prevEp ? goPrev : undefined,
  };
}
