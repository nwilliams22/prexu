import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { PreferencePersistence, type DeepPartial, type PreferencePath, type PreferenceSnapshot } from "./preferencePersistence";
import type { Preferences } from "../types/preferences";

export interface PreferencesContextValue extends PreferenceSnapshot {
  updatePreferences: (partial: DeepPartial<Preferences>) => void;
  resetPreferences: () => void;
  retryLoad: () => void;
  retryPreference: (path: PreferencePath) => void;
  revertPreference: (path: PreferencePath) => void;
}
const PreferencesContext = createContext<PreferencesContextValue | null>(null);
export const PreferencesProvider = PreferencesContext.Provider;
export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
export function usePreferencesState(userId?: number | null): PreferencesContextValue {
  const scope = userId || null;
  const store = useMemo(() => new PreferencePersistence(scope), [scope]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(store.activate, [store]);
  return useMemo(() => ({ ...snapshot, updatePreferences: store.updatePreferences,
    resetPreferences: store.resetPreferences, retryLoad: store.retryLoad,
    retryPreference: store.retryPreference, revertPreference: store.revertPreference,
  }), [snapshot, store]);
}
