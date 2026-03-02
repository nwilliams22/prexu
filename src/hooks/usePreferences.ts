import { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  getPreferences,
  savePreferences,
  getDefaultPreferences,
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

export function usePreferencesState(): PreferencesContextValue {
  const [preferences, setPreferences] = useState<Preferences>(
    getDefaultPreferences()
  );

  useEffect(() => {
    getPreferences().then(setPreferences);
  }, []);

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
        savePreferences(next);
        return next;
      });
    },
    []
  );

  const resetPreferences = useCallback(() => {
    const defaults = getDefaultPreferences();
    setPreferences(defaults);
    savePreferences(defaults);
  }, []);

  return { preferences, updatePreferences, resetPreferences };
}
