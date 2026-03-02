import { useState, useEffect } from "react";
import { useAuth } from "./useAuth";
import { getFilterOptions } from "../services/plex-library";
import type { FilterOption } from "../types/library";

export interface UseFilterOptionsResult {
  genres: FilterOption[];
  years: FilterOption[];
  contentRatings: FilterOption[];
  isLoading: boolean;
}

export function useFilterOptions(
  sectionId: string | undefined
): UseFilterOptionsResult {
  const { server } = useAuth();
  const [genres, setGenres] = useState<FilterOption[]>([]);
  const [years, setYears] = useState<FilterOption[]>([]);
  const [contentRatings, setContentRatings] = useState<FilterOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!server || !sectionId) return;

    let cancelled = false;
    setIsLoading(true);

    Promise.all([
      getFilterOptions(server.uri, server.accessToken, sectionId, "genre"),
      getFilterOptions(server.uri, server.accessToken, sectionId, "year"),
      getFilterOptions(
        server.uri,
        server.accessToken,
        sectionId,
        "contentRating"
      ),
    ])
      .then(([g, y, cr]) => {
        if (!cancelled) {
          setGenres(g);
          setYears(y);
          setContentRatings(cr);
        }
      })
      .catch(() => {
        // Filter options are non-critical — fail silently
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [server, sectionId]);

  return { genres, years, contentRatings, isLoading };
}
