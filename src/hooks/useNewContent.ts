import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";
import { useLibrary } from "./useLibrary";
import { getRecentlyAdded } from "../services/plex-library";
import {
  getLastSeenTimestamps,
  markSectionSeen as storageMarkSectionSeen,
  markAllSectionsSeen,
  getAppLastLaunch,
  saveAppLastLaunch,
} from "../services/storage";
import type { PlexMediaItem } from "../types/library";

const SESSION_KEY = "prexu_session_launched";
const NEW_ITEMS_LIMIT = 20;

export interface UseNewContentResult {
  newSections: Set<string>;
  newItems: PlexMediaItem[];
  markSectionSeen: (sectionKey: string) => void;
  markAllSeen: () => void;
  dismissItem: (ratingKey: string) => void;
  isLoading: boolean;
}

export function useNewContent(): UseNewContentResult {
  const { server } = useAuth();
  const { sections } = useLibrary();

  const [newSections, setNewSections] = useState<Set<string>>(new Set());
  const [newItems, setNewItems] = useState<PlexMediaItem[]>([]);
  const [dismissedItems, setDismissedItems] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const initRef = useRef(false);

  useEffect(() => {
    if (!server || sections.length === 0 || initRef.current) return;
    initRef.current = true;

    const init = async () => {
      setIsLoading(true);

      // Record app launch for new session detection
      const isNewSession = !sessionStorage.getItem(SESSION_KEY);
      let lastLaunch = await getAppLastLaunch();

      if (isNewSession) {
        sessionStorage.setItem(SESSION_KEY, "1");
        if (lastLaunch > 0) {
          // Save current time as new launch, but use the previous launch for comparison
          saveAppLastLaunch(Math.floor(Date.now() / 1000));
        } else {
          // First ever launch — set launch time to now, no "new" items
          lastLaunch = Math.floor(Date.now() / 1000);
          await saveAppLastLaunch(lastLaunch);
        }
      }

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

      // Fetch recently added items and filter to those added since last launch
      if (lastLaunch > 0) {
        try {
          const items = await getRecentlyAdded(
            server.uri,
            server.accessToken,
            NEW_ITEMS_LIMIT
          );
          const newSinceLaunch = items.filter(
            (item) => item.addedAt > lastLaunch
          );
          setNewItems(newSinceLaunch);
        } catch {
          // Silently fail — new items is optional
        }
      }

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
    setNewItems([]);
    const keys = sections.map((s) => s.key);
    markAllSectionsSeen(keys);
    saveAppLastLaunch(Math.floor(Date.now() / 1000));
  }, [sections]);

  const dismissItem = useCallback((ratingKey: string) => {
    setDismissedItems((prev) => {
      const next = new Set(prev);
      next.add(ratingKey);
      return next;
    });
  }, []);

  const visibleNewItems = newItems.filter(
    (item) => !dismissedItems.has(item.ratingKey)
  );

  return {
    newSections,
    newItems: visibleNewItems,
    markSectionSeen,
    markAllSeen,
    dismissItem,
    isLoading,
  };
}
