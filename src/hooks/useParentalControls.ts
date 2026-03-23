import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import {
  getParentalControls,
  saveParentalControls,
} from "../services/storage";
import {
  isRatingAllowed,
  DEFAULT_PARENTAL_CONTROLS,
} from "../types/parental-controls";
import type {
  ContentRatingLevel,
  ParentalControlSettings,
} from "../types/parental-controls";

export interface ParentalControlsContextValue {
  /** Whether content restrictions are active for the current user */
  restrictionsEnabled: boolean;
  /** Maximum allowed content rating level */
  maxContentRating: ContentRatingLevel;
  /** Filter an array of items, keeping only those allowed by the rating restriction */
  filterByRating: <T extends { contentRating?: string }>(items: T[]) => T[];
  /** Check if a single item's content rating is allowed */
  isItemAllowed: (contentRating: string | undefined) => boolean;
  /** Load parental controls for a specific user (used by admin settings panel) */
  loadForUser: (userId: number) => Promise<ParentalControlSettings>;
  /** Save parental controls for a specific user (used by admin settings panel) */
  saveForUser: (userId: number, settings: ParentalControlSettings) => Promise<void>;
}

const ParentalControlsContext = createContext<ParentalControlsContextValue | null>(null);

export const ParentalControlsProvider = ParentalControlsContext.Provider;

export function useParentalControls(): ParentalControlsContextValue {
  const ctx = useContext(ParentalControlsContext);
  if (!ctx) {
    throw new Error("useParentalControls must be used within ParentalControlsProvider");
  }
  return ctx;
}

export function useParentalControlsState(
  userId?: number | null,
): ParentalControlsContextValue {
  const [settings, setSettings] = useState<ParentalControlSettings>(
    DEFAULT_PARENTAL_CONTROLS,
  );

  // Load settings when userId changes
  useEffect(() => {
    if (!userId) {
      setSettings(DEFAULT_PARENTAL_CONTROLS);
      return;
    }

    getParentalControls(userId).then(setSettings);
  }, [userId]);

  const restrictionsEnabled = settings.enabled && settings.maxContentRating !== "none";

  const isItemAllowedFn = useCallback(
    (contentRating: string | undefined): boolean => {
      if (!restrictionsEnabled) return true;
      return isRatingAllowed(contentRating, settings.maxContentRating);
    },
    [restrictionsEnabled, settings.maxContentRating],
  );

  const filterByRating = useCallback(
    <T extends { contentRating?: string }>(items: T[]): T[] => {
      if (!restrictionsEnabled) return items;
      return items.filter((item) =>
        isRatingAllowed(item.contentRating, settings.maxContentRating),
      );
    },
    [restrictionsEnabled, settings.maxContentRating],
  );

  const loadForUser = useCallback(
    async (uid: number): Promise<ParentalControlSettings> => {
      return getParentalControls(uid);
    },
    [],
  );

  const saveForUser = useCallback(
    async (uid: number, newSettings: ParentalControlSettings): Promise<void> => {
      await saveParentalControls(uid, newSettings);
      // If we just saved for the currently active user, update local state
      if (uid === userId) {
        setSettings(newSettings);
      }
    },
    [userId],
  );

  return useMemo(
    () => ({
      restrictionsEnabled,
      maxContentRating: settings.maxContentRating,
      filterByRating,
      isItemAllowed: isItemAllowedFn,
      loadForUser,
      saveForUser,
    }),
    [restrictionsEnabled, settings.maxContentRating, filterByRating, isItemAllowedFn, loadForUser, saveForUser],
  );
}
