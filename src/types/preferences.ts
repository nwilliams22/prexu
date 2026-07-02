export type NormalizationPreset = "off" | "light" | "night";

/**
 * Player engine selection (prexu-axj4.4).
 * - "auto": use native (libmpv) when the platform supports it, else HTML5.
 * - "native": explicit opt-in — resolves identically to "auto" today (both
 *   pick native when the platform supports it); kept distinct for intent.
 * - "html5": force the HTML5 <video> + hls.js backend even when native is
 *   available.
 * See src/hooks/player/engineResolution.ts for the resolution logic.
 */
export type PlayerEnginePreference = "auto" | "native" | "html5";

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
  autoPlayEnabled: boolean;
  subtitleStyle: SubtitleStylePreferences;
  /** Defaults to "auto" — see PlayerEnginePreference. Stored prefs saved
   *  before this field existed merge with getDefaultPreferences(), which
   *  fills it in gracefully (see services/storage/preferences.ts). */
  playerEngine: PlayerEnginePreference;
}

export type ThemeMode = "system" | "dark" | "light";

export interface AppearancePreferences {
  theme: ThemeMode;
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
