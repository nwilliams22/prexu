import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";
import { useLibrary } from "./useLibrary";
import {
  getLastSeenTimestamps,
  markSectionSeen as storageMarkSectionSeen,
  markAllSectionsSeen,
} from "../services/storage";

export interface UseNewContentResult {
  newSections: Set<string>;
  markSectionSeen: (sectionKey: string) => void;
  markAllSeen: () => void;
  isLoading: boolean;
}

export function useNewContent(): UseNewContentResult {
  const { server } = useAuth();
  const { sections } = useLibrary();

  const [newSections, setNewSections] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const initRef = useRef(false);

  useEffect(() => {
    if (!server || sections.length === 0 || initRef.current) return;
    initRef.current = true;

    const init = async () => {
      setIsLoading(true);

      // Check which sections have been updated since last seen
      const timestamps = await getLastSeenTimestamps();
      const updatedSections = new Set<string>();

      for (const section of sections) {
        const lastSeen = timestamps[section.key] ?? 0;
        if (section.updatedAt > lastSeen) {
          updatedSections.add(section.key);
        }
      }
      setNewSections(updatedSections);

      setIsLoading(false);
    };

    init();
  }, [server, sections]);

  const markSectionSeen = useCallback((sectionKey: string) => {
    setNewSections((prev) => {
      if (!prev.has(sectionKey)) return prev;
      const next = new Set(prev);
      next.delete(sectionKey);
      return next;
    });
    storageMarkSectionSeen(sectionKey);
  }, []);

  const markAllSeen = useCallback(() => {
    setNewSections(new Set());
    const keys = sections.map((s) => s.key);
    markAllSectionsSeen(keys);
  }, [sections]);

  return {
    newSections,
    markSectionSeen,
    markAllSeen,
    isLoading,
  };
}
