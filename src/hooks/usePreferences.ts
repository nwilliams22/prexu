import { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  getPreferences,
  savePreferences,
  getDefaultPreferences,
  getUserPreferences,
  saveUserPreferences,
} from "../services/storage";
import type { Preferences } from "../types/preferences";

export interface PreferencesContextValue {
  preferences: Preferences;
  updatePreferences: (partial: DeepPartial<Preferences>) => void;
  resetPreferences: () => void;
}

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export const PreferencesProvider = PreferencesContext.Provider;

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error("usePreferences must be used within PreferencesProvider");
  }
  return ctx;
}

export function usePreferencesState(
  userId?: number | null
): PreferencesContextValue {
  const [preferences, setPreferences] = useState<Preferences>(
    getDefaultPreferences()
  );

  // Re-load preferences when userId changes
  useEffect(() => {
    if (userId) {
      getUserPreferences(userId).then(setPreferences);
    } else {
      getPreferences().then(setPreferences);
    }
  }, [userId]);

  const updatePreferences = useCallback(
    (partial: DeepPartial<Preferences>) => {
      setPreferences((prev) => {
        const next: Preferences = {
          playback: {
            ...prev.playback,
            ...(partial.playback as Partial<Preferences["playback"]>),
          },
          appearance: {
            ...prev.appearance,
            ...(partial.appearance as Partial<Preferences["appearance"]>),
            dashboardSections: {
              ...prev.appearance.dashboardSections,
              ...(partial.appearance?.dashboardSections as Partial<
                Preferences["appearance"]["dashboardSections"]
              >),
            },
          },
        };
        // Save to per-user key if userId is known, otherwise global
        if (userId) {
          saveUserPreferences(userId, next);
        } else {
          savePreferences(next);
        }
        return next;
      });
    },
    [userId]
  );

  const resetPreferences = useCallback(() => {
    const defaults = getDefaultPreferences();
    setPreferences(defaults);
    if (userId) {
      saveUserPreferences(userId, defaults);
    } else {
      savePreferences(defaults);
    }
  }, [userId]);

  return { preferences, updatePreferences, resetPreferences };
}
