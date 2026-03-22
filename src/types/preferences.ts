export type NormalizationPreset = "off" | "light" | "night";

export interface SubtitleStylePreferences {
  fontFamily: string;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number; // 0-1
  outlineColor: string;
  outlineWidth: number;     // 0-4 px
  shadowEnabled: boolean;
}

export interface PlaybackPreferences {
  quality: "original" | "1080p" | "720p" | "480p";
  preferredAudioLanguage: string;
  preferredSubtitleLanguage: string;
  defaultSubtitles: "auto" | "always" | "off";
  subtitleSize: number;
  audioBoost: number;
  directPlayPreference: "auto" | "always" | "never";
  volumeBoost: number;
  normalizationPreset: NormalizationPreset;
  audioOffsetMs: number;
  skipIntroEnabled: boolean;
  skipCreditsEnabled: boolean;
  subtitleStyle: SubtitleStylePreferences;
}

export interface AppearancePreferences {
  posterSize: "small" | "medium" | "large";
  sidebarCollapsed: boolean;
  dashboardSections: {
    continueWatching: boolean;
    recentMovies: boolean;
    recentShows: boolean;
  };
  /** Skip the seasons page for single-season shows and go straight to episode list */
  skipSingleSeason: boolean;
  /** Minimum number of items for a collection to appear (2–10, default 2) */
  minCollectionSize: number;
}

export interface Preferences {
  playback: PlaybackPreferences;
  appearance: AppearancePreferences;
}
