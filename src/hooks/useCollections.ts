import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";
import { useLibrary } from "./useLibrary";
import { getCollections } from "../services/plex-library";
import type { LibrarySection, PlexCollection } from "../types/library";

export interface CollectionGroup {
  section: LibrarySection;
  items: PlexCollection[];
}

export interface UseCollectionsResult {
  collections: CollectionGroup[];
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

export function useCollections(): UseCollectionsResult {
  const { server } = useAuth();
  const { sections } = useLibrary();
  const [collections, setCollections] = useState<CollectionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const retry = useCallback(() => {
    setRefreshTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!server || sections.length === 0) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const eligible = sections.filter(
      (s) => s.type === "movie" || s.type === "show"
    );

    Promise.all(
      eligible.map(async (section) => {
        try {
          const items = await getCollections(
            server.uri,
            server.accessToken,
            section.key
          );
          return { section, items };
        } catch {
          return { section, items: [] as PlexCollection[] };
        }
      })
    )
      .then((groups) => {
        if (!cancelled) {
          // Only include sections that have collections
          setCollections(groups.filter((g) => g.items.length > 0));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load collections"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [server, sections, refreshTrigger]);

  return { collections, isLoading, error, retry };
}
