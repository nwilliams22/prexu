export type NormalizationPreset = "off" | "light" | "night";

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
}

export interface Preferences {
  playback: PlaybackPreferences;
  appearance: AppearancePreferences;
}
