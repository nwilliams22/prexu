import { useState, useEffect } from "react";
import {
  searchTmdbPerson,
  getTmdbPersonDetail,
  getTmdbPersonCredits,
  type TmdbPersonDetail,
  type TmdbCreditEntry,
} from "../services/tmdb";

export interface TmdbPersonData {
  personDetail: TmdbPersonDetail | null;
  credits: TmdbCreditEntry[];
  knownFor: TmdbCreditEntry[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetch TMDb person detail and credits for a given actor name.
 * Builds a "Known For" list from the top credits by popularity.
 */
export function useTmdbPersonData(actorName: string | undefined): TmdbPersonData {
  const [personDetail, setPersonDetail] = useState<TmdbPersonDetail | null>(null);
  const [credits, setCredits] = useState<TmdbCreditEntry[]>([]);
  const [knownFor, setKnownFor] = useState<TmdbCreditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!actorName) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const person = await searchTmdbPerson(actorName);
        if (!person || cancelled) {
          if (!cancelled) setIsLoading(false);
          return;
        }

        const [detail, creds] = await Promise.all([
          getTmdbPersonDetail(person.id),
          getTmdbPersonCredits(person.id),
        ]);

        if (cancelled) return;

        if (detail) setPersonDetail(detail);

        if (creds.length > 0) {
          setCredits(creds);

          // Build "Known For" -- top entries by popularity, deduped
          const seen = new Set<number>();
          const knownForList: TmdbCreditEntry[] = [];
          const sorted = [...creds]
            .filter((c) => c.character && !c.character.includes("Self"))
            .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

          for (const c of sorted) {
            if (seen.has(c.id)) continue;
            seen.add(c.id);
            knownForList.push(c);
            if (knownForList.length >= 15) break;
          }
          setKnownFor(knownForList);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load TMDb data");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actorName]);

  return { personDetail, credits, knownFor, isLoading, error };
}
