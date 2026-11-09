export const SETTINGS_CATEGORIES = [
  { id: "playback", label: "Playback", description: "Choose playback quality and episode behavior." },
  { id: "audio", label: "Audio", description: "Set preferred language, loudness and timing." },
  { id: "subtitles", label: "Subtitles", description: "Choose subtitle defaults and appearance." },
  { id: "appearance", label: "Appearance", description: "Customize the interface and library browsing." },
  { id: "connections", label: "Connections & notifications", description: "Configure the relay and invitation sounds." },
  { id: "parental-controls", label: "Parental controls", description: "Manage content restrictions for members of your Plex Home." },
  { id: "about", label: "About", description: "App information and support." },
] as const;

export type SettingsCategory = typeof SETTINGS_CATEGORIES[number]["id"];
