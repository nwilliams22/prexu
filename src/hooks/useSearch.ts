import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "./useAuth";
import { searchLibrary } from "../services/plex-library";
import type { PlexHub } from "../types/library";

const DEBOUNCE_MS = 300;

export function useSearch() {
  const { server } = useAuth();
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

  return { query, results, isSearching, error };
}
