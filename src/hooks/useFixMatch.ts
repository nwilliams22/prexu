/**
 * Hook for the Fix Match dialog — manages search state and API calls
 * for matching library items to the correct metadata.
 */

import { useState, useCallback } from "react";
import { useAuth } from "./useAuth";
import {
  searchMatches,
  searchMatchByImdb,
  applyMatch as applyMatchApi,
  refreshMetadata,
  getAgentForType,
} from "../services/plex-match";
import type { PlexSearchResult } from "../types/fix-match";

export interface UseFixMatchResult {
  searchResults: PlexSearchResult[];
  isSearching: boolean;
  searchError: string | null;
  isApplying: boolean;
  applyError: string | null;

  /** Search for matches by title (and optional year). */
  search: (title: string, year?: string, mediaType?: string) => Promise<void>;

  /** Search for matches by IMDb ID. */
  searchByImdb: (imdbId: string, mediaType?: string) => Promise<void>;

  /**
   * Apply a selected match and refresh metadata.
   * Returns true on success, false on failure.
   */
  applyMatch: (
    guid: string,
    name: string,
    year: number,
  ) => Promise<boolean>;

  /** Clear search results and errors. */
  reset: () => void;
}

export function useFixMatch(ratingKey: string): UseFixMatchResult {
  const { server } = useAuth();
  const [searchResults, setSearchResults] = useState<PlexSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const search = useCallback(
    async (title: string, year?: string, mediaType?: string) => {
      if (!server) return;
      setIsSearching(true);
      setSearchError(null);
      setSearchResults([]);

      try {
        const agent = mediaType ? getAgentForType(mediaType) : undefined;
        const results = await searchMatches(
          server.uri,
          server.accessToken,
          ratingKey,
          title,
          year,
          agent,
        );
        setSearchResults(results);
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : "Search failed",
        );
      } finally {
        setIsSearching(false);
      }
    },
    [server, ratingKey],
  );

  const searchByImdb = useCallback(
    async (imdbId: string, mediaType?: string) => {
      if (!server) return;
      setIsSearching(true);
      setSearchError(null);
      setSearchResults([]);

      try {
        const agent = mediaType ? getAgentForType(mediaType) : undefined;
        const results = await searchMatchByImdb(
          server.uri,
          server.accessToken,
          ratingKey,
          imdbId,
          agent,
        );
        setSearchResults(results);
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : "IMDb search failed",
        );
      } finally {
        setIsSearching(false);
      }
    },
    [server, ratingKey],
  );

  const applyMatch = useCallback(
    async (guid: string, name: string, year: number): Promise<boolean> => {
      if (!server) return false;
      setIsApplying(true);
      setApplyError(null);

      try {
        await applyMatchApi(
          server.uri,
          server.accessToken,
          ratingKey,
          guid,
          name,
          year,
        );

        // Refresh metadata after applying the match
        await refreshMetadata(server.uri, server.accessToken, ratingKey);

        return true;
      } catch (err) {
        setApplyError(
          err instanceof Error ? err.message : "Failed to apply match",
        );
        return false;
      } finally {
        setIsApplying(false);
      }
    },
    [server, ratingKey],
  );

  const reset = useCallback(() => {
    setSearchResults([]);
    setSearchError(null);
    setApplyError(null);
  }, []);

  return {
    searchResults,
    isSearching,
    searchError,
    isApplying,
    applyError,
    search,
    searchByImdb,
    applyMatch,
    reset,
  };
}
