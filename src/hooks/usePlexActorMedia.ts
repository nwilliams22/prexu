import { useState, useEffect } from "react";
import { getMediaByActor, searchLibrary } from "../services/plex-library";
import type { PlexMediaItem } from "../types/library";
import type { TmdbCreditEntry } from "../services/tmdb";

export interface PlexActorMedia {
  movies: PlexMediaItem[];
  shows: PlexMediaItem[];
  /** Lowercase title -> PlexMediaItem for "On Server" matching */
  serverItemMap: Map<string, PlexMediaItem>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetch Plex media for an actor: combines actor-filter results, hub search,
 * and cross-references TMDb known-for titles to catch voice/guest roles.
 */
export function usePlexActorMedia(
  serverUri: string | undefined,
  serverToken: string | undefined,
  actorName: string | undefined,
  knownFor: TmdbCreditEntry[],
  tmdbReady: boolean,
): PlexActorMedia {
  const [movies, setMovies] = useState<PlexMediaItem[]>([]);
  const [shows, setShows] = useState<PlexMediaItem[]>([]);
  const [serverItemMap, setServerItemMap] = useState<Map<string, PlexMediaItem>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serverUri || !serverToken || !actorName || !tmdbReady) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [plexResult, plexSearchResult] = await Promise.allSettled([
          getMediaByActor(serverUri, serverToken, actorName),
          searchLibrary(serverUri, serverToken, actorName, 50),
        ]);

        if (cancelled) return;

        const seen = new Set<string>();
        const movieItems: PlexMediaItem[] = [];
        const showItems: PlexMediaItem[] = [];

        const addItem = (item: PlexMediaItem) => {
          if (seen.has(item.ratingKey)) return;
          seen.add(item.ratingKey);
          if (item.type === "movie") movieItems.push(item);
          else if (item.type === "show") showItems.push(item);
        };

        // Primary: actor filter results
        if (plexResult.status === "fulfilled") {
          for (const item of plexResult.value) addItem(item);
        }

        // Supplemental: hub search results (catches voice/guest roles)
        if (plexSearchResult.status === "fulfilled") {
          for (const hub of plexSearchResult.value) {
            if (hub.Metadata) {
              for (const item of hub.Metadata) {
                if (item.type === "movie" || item.type === "show") addItem(item);
              }
            }
          }
        }

        // Cross-reference: search Plex for TMDB credit titles not already in server results
        const serverTitleSet = new Set<string>();
        for (const m of movieItems) serverTitleSet.add(m.title.toLowerCase());
        for (const s of showItems) serverTitleSet.add(s.title.toLowerCase());

        const missingTitles = knownFor.filter((c) => {
          const title = (c.title ?? c.name ?? "").toLowerCase();
          return title && !serverTitleSet.has(title);
        });

        if (missingTitles.length > 0 && !cancelled) {
          const titleSearches = await Promise.allSettled(
            missingTitles.map((c) =>
              searchLibrary(serverUri, serverToken, c.title ?? c.name ?? "", 5)
            )
          );

          for (let i = 0; i < titleSearches.length; i++) {
            const result = titleSearches[i];
            if (result.status !== "fulfilled") continue;
            const searchTitle = (missingTitles[i].title ?? missingTitles[i].name ?? "").toLowerCase();
            for (const hub of result.value) {
              if (hub.Metadata) {
                for (const item of hub.Metadata) {
                  if (
                    item.title.toLowerCase() === searchTitle &&
                    (item.type === "movie" || item.type === "show")
                  ) {
                    addItem(item);
                  }
                }
              }
            }
          }
        }

        const byYear = (a: PlexMediaItem, b: PlexMediaItem) => {
          const ay = (a as unknown as { year?: number }).year ?? 0;
          const by = (b as unknown as { year?: number }).year ?? 0;
          return by - ay;
        };
        movieItems.sort(byYear);
        showItems.sort(byYear);

        if (!cancelled) {
          setMovies(movieItems);
          setShows(showItems);

          const titleMap = new Map<string, PlexMediaItem>();
          for (const m of movieItems) titleMap.set(m.title.toLowerCase(), m);
          for (const s of showItems) titleMap.set(s.title.toLowerCase(), s);
          setServerItemMap(titleMap);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load server media");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // knownFor is an array that changes identity; tmdbReady gates it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUri, serverToken, actorName, tmdbReady]);

  return { movies, shows, serverItemMap, isLoading, error };
}
