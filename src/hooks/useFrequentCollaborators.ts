import { useState, useEffect } from "react";
import {
  getTmdbMovieDetail,
  getTmdbTvDetail,
  type TmdbCreditEntry,
} from "../services/tmdb";
import type { PlexMediaItem } from "../types/library";

export interface Collaborator {
  name: string;
  count: number;
  profilePath: string | null;
  sharedTitles: string[];
}

/**
 * Calculate frequent collaborators by fetching TMDB details for the actor's
 * top credits and counting co-star appearances across multiple titles.
 */
export function useFrequentCollaborators(
  actorName: string | undefined,
  knownFor: TmdbCreditEntry[],
  serverItemMap: Map<string, PlexMediaItem>,
  ready: boolean,
): Collaborator[] {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  useEffect(() => {
    if (!actorName || !ready || knownFor.length === 0) return;
    let cancelled = false;

    (async () => {
      // Pick top credits that are on the server, or fall back to top credits overall
      const serverCredits = knownFor.filter((c) =>
        serverItemMap.has((c.title ?? c.name ?? "").toLowerCase())
      );
      const creditsToFetch = (
        serverCredits.length >= 4 ? serverCredits : knownFor
      ).slice(0, 8);

      const detailResults = await Promise.allSettled(
        creditsToFetch.map((c) =>
          c.media_type === "movie"
            ? getTmdbMovieDetail(c.id)
            : getTmdbTvDetail(c.id)
        )
      );

      if (cancelled) return;

      // Count co-star appearances across all fetched movies/shows
      const costarCounts = new Map<
        string,
        { count: number; profilePath: string | null; titles: string[] }
      >();
      const actorNameLower = actorName.toLowerCase();

      for (let i = 0; i < detailResults.length; i++) {
        const result = detailResults[i];
        if (result.status !== "fulfilled" || !result.value) continue;
        const detail = result.value;
        const cast = detail.credits?.cast ?? [];
        const creditTitle =
          "title" in detail ? detail.title : (detail as { name: string }).name;

        for (const member of cast.slice(0, 15)) {
          if (member.name.toLowerCase() === actorNameLower) continue;
          const existing = costarCounts.get(member.name);
          if (existing) {
            existing.count++;
            existing.titles.push(creditTitle);
            if (!existing.profilePath && member.profile_path) {
              existing.profilePath = member.profile_path;
            }
          } else {
            costarCounts.set(member.name, {
              count: 1,
              profilePath: member.profile_path,
              titles: [creditTitle],
            });
          }
        }
      }

      // Keep only people appearing in 2+ titles, sorted by count
      const collabs = [...costarCounts.entries()]
        .filter(([, v]) => v.count >= 2)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 6)
        .map(([name, v]) => ({
          name,
          count: v.count,
          profilePath: v.profilePath,
          sharedTitles: v.titles,
        }));

      if (!cancelled) setCollaborators(collabs);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorName, ready]);

  return collaborators;
}
