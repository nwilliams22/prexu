/**
 * User preferences storage: global and per-user preferences with defaults.
 */

import type { Preferences } from "../../types/preferences";
import { STORAGE_KEYS, localStore } from "./backends";

// ── Defaults ──

export function getDefaultPreferences(): Preferences {
  return {
    playback: {
      quality: "1080p",
      preferredAudioLanguage: "",
      preferredSubtitleLanguage: "",
      defaultSubtitles: "auto",
      subtitleSize: 100,
      audioBoost: 100,
      directPlayPreference: "never",
      volumeBoost: 1.0,
      normalizationPreset: "off",
      audioOffsetMs: 0,
      skipIntroEnabled: true,
      skipCreditsEnabled: true,
      subtitleStyle: {
        fontFamily: "sans-serif",
        textColor: "#FFFFFF",
        backgroundColor: "#000000",
        backgroundOpacity: 0.75,
        outlineColor: "#000000",
        outlineWidth: 2,
        shadowEnabled: true,
      },
    },
    appearance: {
      theme: "system",
      posterSize: "medium",
      sidebarCollapsed: false,
      dashboardSections: {
        continueWatching: true,
        recentMovies: true,
        recentShows: true,
      },
      skipSingleSeason: true,
      minCollectionSize: 2,
    },
  };
}

function mergeWithDefaults(saved: Preferences): Preferences {
  const defaults = getDefaultPreferences();
  return {
    playback: { ...defaults.playback, ...saved.playback },
    appearance: {
      ...defaults.appearance,
      ...saved.appearance,
      dashboardSections: {
        ...defaults.appearance.dashboardSections,
        ...saved.appearance?.dashboardSections,
      },
    },
  };
}

// ── Global preferences ──

export async function getPreferences(): Promise<Preferences> {
  const saved = await localStore.get<Preferences>(STORAGE_KEYS.PREFERENCES);
  if (!saved) return getDefaultPreferences();
  return mergeWithDefaults(saved);
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await localStore.set(STORAGE_KEYS.PREFERENCES, prefs);
}

// ── Per-user preferences ──

function userPrefsKey(userId: number): string {
  return `prexu_preferences_${userId}`;
}

export async function getUserPreferences(userId: number): Promise<Preferences> {
  const saved = await localStore.get<Preferences>(userPrefsKey(userId));
  if (!saved) {
    // Fall back to global prefs (migration path for existing users)
    const global = await localStore.get<Preferences>(STORAGE_KEYS.PREFERENCES);
    if (global) return mergeWithDefaults(global);
    return getDefaultPreferences();
  }
  return mergeWithDefaults(saved);
}

export async function saveUserPreferences(
  userId: number,
  prefs: Preferences
): Promise<void> {
  await localStore.set(userPrefsKey(userId), prefs);
}
