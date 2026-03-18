/**
 * Hook encapsulating TMDb search logic: debounced text search and IMDb ID lookup.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  searchTmdbMovies,
  searchTmdbTvShows,
  findByImdbId,
  isValidImdbId,
  isTmdbAvailable,
} from "../services/tmdb";
import type {
  TmdbMovie,
  TmdbTvShow,
  TmdbSearchResult,
} from "../types/content-request";

type MediaTab = "movie" | "tv";
type SearchMode = "search" | "imdb";

export interface UseTmdbSearchReturn {
  tmdbReady: boolean;
  tmdbLoading: boolean;
  results: (TmdbMovie | TmdbTvShow)[];
  isSearching: boolean;
  searchError: string | null;
  query: string;
  setQuery: (q: string) => void;
  mediaTab: MediaTab;
  setMediaTab: (tab: MediaTab) => void;
  searchMode: SearchMode;
  setSearchMode: (mode: SearchMode) => void;
  imdbInput: string;
  setImdbInput: (val: string) => void;
  clearResults: () => void;
  clearError: () => void;
  handleImdbLookup: () => Promise<TmdbSearchResult | null>;
  handleSelectResult: (item: TmdbMovie | TmdbTvShow) => TmdbSearchResult;
}

export function useTmdbSearch(opts?: {
  initialQuery?: string;
  initialMediaType?: MediaTab;
}): UseTmdbSearchReturn {
  const [tmdbReady, setTmdbReady] = useState(false);
  const [tmdbLoading, setTmdbLoading] = useState(true);
  const [searchMode, setSearchMode] = useState<SearchMode>("search");
  const [mediaTab, setMediaTab] = useState<MediaTab>(opts?.initialMediaType ?? "movie");
  const [query, setQuery] = useState(opts?.initialQuery ?? "");
  const [imdbInput, setImdbInput] = useState("");
  const [results, setResults] = useState<(TmdbMovie | TmdbTvShow)[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchVersionRef = useRef(0);

  // Check TMDb proxy availability on mount
  useEffect(() => {
    (async () => {
      const available = await isTmdbAvailable();
      setTmdbReady(available);
      setTmdbLoading(false);
    })();
  }, []);

  // Debounced TMDb search
  useEffect(() => {
    if (searchMode !== "search" || !tmdbReady || query.trim().length < 2) {
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const version = ++searchVersionRef.current;
      setIsSearching(true);
      setSearchError(null);

      try {
        const { results: data } =
          mediaTab === "movie"
            ? await searchTmdbMovies(query.trim())
            : await searchTmdbTvShows(query.trim());

        if (version === searchVersionRef.current) {
          setResults(data);
        }
      } catch (err) {
        if (version === searchVersionRef.current) {
          setSearchError(
            err instanceof Error ? err.message : "Search failed",
          );
        }
      } finally {
        if (version === searchVersionRef.current) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mediaTab, searchMode, tmdbReady]);

  const clearResults = useCallback(() => setResults([]), []);
  const clearError = useCallback(() => setSearchError(null), []);

  const handleImdbLookup = useCallback(async (): Promise<TmdbSearchResult | null> => {
    if (!tmdbReady || !isValidImdbId(imdbInput.trim())) return null;

    setIsSearching(true);
    setSearchError(null);
    setResults([]);

    try {
      const result = await findByImdbId(imdbInput.trim());
      if (!result) {
        setSearchError("No results found for this IMDb ID");
      }
      return result;
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Lookup failed",
      );
      return null;
    } finally {
      setIsSearching(false);
    }
  }, [tmdbReady, imdbInput]);

  const handleSelectResult = useCallback(
    (item: TmdbMovie | TmdbTvShow): TmdbSearchResult => {
      if ("title" in item) {
        return { ...item, media_type: "movie" };
      }
      return { ...item, media_type: "tv" };
    },
    [],
  );

  return {
    tmdbReady,
    tmdbLoading,
    results,
    isSearching,
    searchError,
    query,
    setQuery,
    mediaTab,
    setMediaTab,
    searchMode,
    setSearchMode,
    imdbInput,
    setImdbInput,
    clearResults,
    clearError,
    handleImdbLookup,
    handleSelectResult,
  };
}
