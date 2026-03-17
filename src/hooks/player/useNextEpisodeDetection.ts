/**
 * Detects the next episode for Watch Together host auto-play prompt.
 */

import { useState, useEffect, useRef } from "react";
import { getItemMetadata, getNextEpisode } from "../../services/plex-library";
import type { PlexEpisode, PlexMediaItem } from "../../types/library";

export function useNextEpisodeDetection(
  isInSession: boolean,
  isHost: boolean,
  server: { uri: string; accessToken: string } | null,
  ratingKey: string | undefined,
): PlexEpisode | null {
  const [nextEp, setNextEp] = useState<PlexEpisode | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!isInSession || !isHost || !server || !ratingKey) return;
    if (fetchedRef.current) return;

    (async () => {
      try {
        const item = await getItemMetadata<PlexMediaItem>(
          server.uri,
          server.accessToken,
          ratingKey,
        );
        if (item.type === "episode") {
          const next = await getNextEpisode(
            server.uri,
            server.accessToken,
            item as PlexEpisode,
          );
          setNextEp(next);
          fetchedRef.current = true;
        }
      } catch {
        // Non-critical — just won't show the prompt
      }
    })();
  }, [isInSession, isHost, server, ratingKey]);

  return nextEp;
}
