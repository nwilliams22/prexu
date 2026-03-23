import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "./useAuth";
import { useParentalControls } from "./useParentalControls";
import { searchLibrary } from "../services/plex-library";
import type { PlexHub, PlexMediaItem } from "../types/library";

const DEBOUNCE_MS = 300;

export function useSearch() {
  const { server } = useAuth();
  const { restrictionsEnabled, filterByRating } = useParentalControls();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";

  const [results, setResults] = useState<PlexHub[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef("");

  useEffect(() => {
    if (!server || !query.trim()) {
      setResults([]);
      setIsSearching(false);
      setError(null);
      return;
    }

    // Don't re-fetch if query hasn't actually changed
    if (query === lastQueryRef.current) return;

    setIsSearching(true);
    setError(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        const hubs = await searchLibrary(
          server.uri,
          server.accessToken,
          query.trim(),
          15
        );
        // Only update if query hasn't changed while we were fetching
        lastQueryRef.current = query;
        // Filter out empty hubs
        setResults(hubs.filter((h) => h.Metadata && h.Metadata.length > 0));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Search failed"
        );
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [server, query]);

  // Apply parental controls filtering to search results
  const filteredResults = useMemo(() => {
    if (!restrictionsEnabled) return results;
    return results
      .map((hub) => ({
        ...hub,
        Metadata: filterByRating(
          (hub.Metadata ?? []) as (PlexMediaItem & { contentRating?: string })[],
        ),
      }))
      .filter((hub) => hub.Metadata.length > 0);
  }, [results, restrictionsEnabled, filterByRating]);

  return { query, results: filteredResults, isSearching, error };
}
