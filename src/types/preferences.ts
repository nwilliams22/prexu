export interface PlaybackPreferences {
  quality: "original" | "1080p" | "720p" | "480p";
  preferredAudioLanguage: string;
  preferredSubtitleLanguage: string;
  defaultSubtitles: "auto" | "always" | "off";
  subtitleSize: number;
  audioBoost: number;
  directPlayPreference: "auto" | "always" | "never";
}

export interface AppearancePreferences {
  posterSize: "small" | "medium" | "large";
  sidebarCollapsed: boolean;
  dashboardSections: {
    continueWatching: boolean;
    recentMovies: boolean;
    recentShows: boolean;
  };
}

export interface Preferences {
  playback: PlaybackPreferences;
  appearance: AppearancePreferences;
}
