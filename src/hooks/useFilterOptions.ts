import { useState, useEffect } from "react";
import { useAuth } from "./useAuth";
import { getFilterOptions } from "../services/plex-library";
import { cacheGet, cacheSet } from "../services/api-cache";
import type { FilterOption } from "../types/library";

export interface UseFilterOptionsResult {
  genres: FilterOption[];
  years: FilterOption[];
  contentRatings: FilterOption[];
  resolutions: FilterOption[];
  isLoading: boolean;
}

interface FilterOptionsData {
  genres: FilterOption[];
  years: FilterOption[];
  contentRatings: FilterOption[];
  resolutions: FilterOption[];
}

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function useFilterOptions(
  sectionId: string | undefined
): UseFilterOptionsResult {
  const { server } = useAuth();
  const [genres, setGenres] = useState<FilterOption[]>([]);
  const [years, setYears] = useState<FilterOption[]>([]);
  const [contentRatings, setContentRatings] = useState<FilterOption[]>([]);
  const [resolutions, setResolutions] = useState<FilterOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!server || !sectionId) return;

    const cacheKey = `filterOptions:${sectionId}`;
    const cached = cacheGet<FilterOptionsData>(cacheKey);
    if (cached) {
      setGenres(cached.genres);
      setYears(cached.years);
      setContentRatings(cached.contentRatings);
      setResolutions(cached.resolutions ?? []);
      setIsLoading(false);
      return;
    }

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
      getFilterOptions(server.uri, server.accessToken, sectionId, "resolution"),
    ])
      .then(([g, y, cr, res]) => {
        if (!cancelled) {
          setGenres(g);
          setYears(y);
          setContentRatings(cr);
          setResolutions(res);
          cacheSet(cacheKey, { genres: g, years: y, contentRatings: cr, resolutions: res }, CACHE_TTL);
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

  return { genres, years, contentRatings, resolutions, isLoading };
}
