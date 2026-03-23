import { useState, useEffect, useRef } from "react";
import { useAuth } from "./useAuth";
import { searchLibrary } from "../services/plex-library";

const DEBOUNCE_MS = 200;
const SUGGESTION_LIMIT = 5;

export interface SearchSuggestion {
  ratingKey: string;
  title: string;
  type: string;
  thumb: string;
  year?: number;
}

export function useSearchSuggestions(query: string, isOpen: boolean) {
  const { server } = useAuth();
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed || !isOpen || !server) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const requestId = ++staleRef.current;

    debounceRef.current = setTimeout(async () => {
      try {
        const hubs = await searchLibrary(
          server.uri,
          server.accessToken,
          trimmed,
          SUGGESTION_LIMIT
        );
        if (requestId !== staleRef.current) return;

        const items: SearchSuggestion[] = [];
        for (const hub of hubs) {
          if (!hub.Metadata) continue;
          for (const item of hub.Metadata) {
            items.push({
              ratingKey: item.ratingKey,
              title: item.title,
              type: item.type,
              thumb: item.thumb,
              year: "year" in item ? (item as { year?: number }).year : undefined,
            });
            if (items.length >= SUGGESTION_LIMIT) break;
          }
          if (items.length >= SUGGESTION_LIMIT) break;
        }
        setSuggestions(items);
      } catch {
        if (requestId === staleRef.current) {
          setSuggestions([]);
        }
      } finally {
        if (requestId === staleRef.current) {
          setIsLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isOpen, server]);

  return { suggestions, isLoading };
}
