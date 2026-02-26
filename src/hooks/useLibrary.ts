import { useState, useEffect } from "react";
import { useAuth } from "./useAuth";
import { getLibrarySections } from "../services/plex-library";
import type { LibrarySection } from "../types/library";

export interface UseLibraryResult {
  sections: LibrarySection[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetches library sections once when a server is available.
 * Caches for the lifecycle of the component (typically AppLayout,
 * which persists across route changes).
 */
export function useLibrary(): UseLibraryResult {
  const { server } = useAuth();
  const [sections, setSections] = useState<LibrarySection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server) return;

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getLibrarySections(server.uri, server.accessToken);
        if (!cancelled) {
          setSections(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load libraries"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server]);

  return { sections, isLoading, error };
}
