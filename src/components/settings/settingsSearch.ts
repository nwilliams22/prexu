import { SETTINGS_CATEGORIES, type SettingsCategory } from "./settingsCategories";

export interface SettingSearchEntry {
  id: string;
  category: SettingsCategory;
  section: string;
  label: string;
  help: string;
  aliases: readonly string[];
  target: string;
  adminOnly?: boolean;
  nativeOnly?: boolean;
}

function entry(id: string, category: SettingsCategory, section: string, label: string, help: string, aliases: string[] = [], target = id): SettingSearchEntry {
  return { id, category, section, label, help, aliases, target,
    adminOnly: category === "parental-controls" || id === "about-content-search" || id === "about-relay-setup",
    nativeOnly: id === "P1" };
}

// Static copy only: never add preference values, profile names, addresses or filenames.
// Order is the approved category and row order; IDs retain inventory traceability.
export const SETTINGS_SEARCH_ENTRIES: readonly SettingSearchEntry[] = [
  entry("P1", "playback", "Video", "Player Engine", "Applies the next time you open the player.", ["mpv native html5"]),
  entry("P2", "playback", "Video", "Video Quality", "Direct play depends on format support and your Direct Play preference."),
  entry("P3", "playback", "Video", "Direct Play Preference", "Auto will direct play compatible files and transcode others."),
  entry("P4", "playback", "Episodes", "Show Skip Intro button", "Show a Skip Intro button during detected intro segments."),
  entry("P5", "playback", "Episodes", "Show Skip Credits button", "Show a Skip Credits or Next Episode button during credits."),
  entry("P6", "playback", "Episodes", "Play next episode automatically", "Start the next available episode after the countdown.", ["auto-play autoplay"]),
  entry("P7", "audio", "Language", "Preferred Audio Language", "Choose the preferred language for audio."),
  entry("A1", "audio", "Loudness", "Transcode audio boost", "Applied by the server during transcoding."),
  entry("A2", "audio", "Loudness", "Playback volume boost", "Amplifies playback audio. Values above 200% may distort."),
  entry("A3", "audio", "Loudness", "Audio Normalization", "Brings quiet dialogue and loud effects closer in volume; Night Mode applies stronger compression."),
  entry("A4", "audio", "Timing", "Audio delay", "Increase when audio plays before video.", ["offset sync"]),
  entry("L1", "subtitles", "Defaults", "Default Subtitles", "Choose whether subtitles use the server default, stay on or stay off."),
  entry("L2", "subtitles", "Defaults", "Preferred Subtitle Language", "Turn on default subtitles to choose a preferred language."),
  entry("subtitle-preview", "subtitles", "Appearance", "Subtitle preview", "This preview illustrates chosen styling, not a guarantee for all subtitle formats."),
  entry("L3", "subtitles", "Appearance", "Subtitle Size", "Adjust the size of subtitle text."),
  entry("S1", "subtitles", "Appearance", "Font", "Choose the subtitle font family."),
  entry("S2", "subtitles", "Appearance", "Text Color", "Choose the subtitle text color."),
  entry("S3", "subtitles", "Appearance", "Background Color", "Choose the subtitle background color."),
  entry("S4", "subtitles", "Appearance", "Background Opacity", "Adjust subtitle background transparency."),
  entry("S5", "subtitles", "Appearance", "Outline Color", "Choose the subtitle outline color."),
  entry("S6", "subtitles", "Appearance", "Outline Width", "Adjust the subtitle outline width."),
  entry("S7", "subtitles", "Appearance", "Drop shadow", "Show a shadow behind subtitle text."),
  entry("V1", "appearance", "Interface", "Theme", "System follows your operating system's light/dark preference."),
  entry("V2", "appearance", "Interface", "Poster Size", "Choose the size of library posters."),
  entry("V3", "appearance", "Interface", "Sidebar default", "Choose whether the sidebar starts expanded or collapsed."),
  entry("V4", "appearance", "Home", "Continue Watching", "Hidden dashboard sections can be enabled here at any time."),
  entry("V5", "appearance", "Home", "Recently Added Movies", "Hidden dashboard sections can be enabled here at any time."),
  entry("V6", "appearance", "Home", "Recently Added TV Shows", "Hidden dashboard sections can be enabled here at any time."),
  entry("V7", "appearance", "Library browsing", "Skip seasons page for single-season shows", "Go directly to episodes when a show has one season.", ["TV Show Navigation"]),
  entry("V8", "appearance", "Library browsing", "Minimum Collection Size", "Collections with fewer items than this will be hidden from the collections browser and library view."),
  entry("relay-status", "connections", "Relay connection", "Relay connection status", "View the connection status, mode and effective address.", [], "relay-connection-heading"),
  entry("N1", "connections", "Relay connection", "Custom relay URL", "Use a custom ws:// or wss:// relay address, or reset to auto-detect.", [], "relay-edit"),
  entry("N2", "connections", "Invitation sounds", "Invite notification volume", "Adjust invitation volume; increase volume to preview."),
  entry("N3", "connections", "Invitation sounds", "Notification sound", "Choose a built-in sound or load a custom audio file."),
  entry("sound-preview", "connections", "Invitation sounds", "Preview sound", "Play the selected invitation sound."),
  entry("C1", "parental-controls", "Managed users", "Enable content restrictions", "Hide content above the selected rating for each managed user.", [], "parental-controls-target"),
  entry("C2", "parental-controls", "Managed users", "Maximum Allowed Rating", "Enable content restrictions to choose a maximum rating.", [], "parental-controls-target"),
  entry("about-app", "about", "Prexu", "Prexu", "A custom cross-platform Plex client.", ["app description"], "about-app-heading"),
  entry("about-version", "about", "Prexu", "App version", "View the installed app version."),
  entry("about-platform", "about", "Prexu", "Platform", "View the operating system."),
  entry("about-server", "about", "Prexu", "Server", "View the selected server address."),
  entry("about-report-bug", "about", "Prexu", "Report a bug", "Open the Prexu issue tracker."),
  entry("about-github", "about", "Prexu", "GitHub", "Open the Prexu source repository."),
  entry("about-content-search", "about", "Content search", "Content search", "Content search uses the relay; ask the relay administrator to enable search if unavailable.", [], "about-content-search-heading"),
  entry("about-relay-setup", "about", "Content search", "Relay administrator setup", "Configure content search on the relay."),
];

export interface SearchCapabilities { isAdmin: boolean; nativePlayer: boolean }
const categoryAliases: Partial<Record<SettingsCategory, string>> = {
  subtitles: "captions", audio: "volume", appearance: "theme", connections: "relay server", "parental-controls": "rating restrictions",
};
export function searchSettings(query: string, capabilities: SearchCapabilities): SettingSearchEntry[] {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return [];
  const words = normalized.split(" ");
  const rank = (item: SettingSearchEntry) => item.label.toLowerCase() === normalized ? 0 : item.label.toLowerCase().startsWith(normalized) ? 1 : 2;
  return SETTINGS_SEARCH_ENTRIES.filter((item) => {
    if ((item.adminOnly && !capabilities.isAdmin) || (item.nativeOnly && !capabilities.nativePlayer)) return false;
    const category = SETTINGS_CATEGORIES.find((category) => category.id === item.category)!;
    const text = [item.label, category.label, item.section, item.help, ...item.aliases, categoryAliases[item.category] ?? ""].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  }).sort((a, b) => rank(a) - rank(b));
}

/** Focus only an inventory target in the active, permitted category. */
export function focusSettingTarget(id: string, category: SettingsCategory, capabilities: SearchCapabilities) {
  const item = SETTINGS_SEARCH_ENTRIES.find((item) => item.id === id && item.category === category);
  if (!item || (item.adminOnly && !capabilities.isAdmin) || (item.nativeOnly && !capabilities.nativePlayer)) return;
  const target = (id === "N1" ? document.getElementById("N1") : null) ?? document.getElementById(item.target);
  if (!target || target.closest("[hidden]")) return;
  const control = target.matches("fieldset") ? target.querySelector<HTMLElement>("input:checked:not(:disabled)") ?? target.querySelector<HTMLElement>("input:not(:disabled)") : target;
  const focus = control && !control.matches(":disabled") ? control : document.getElementById(`${item.target}-label`) ?? document.getElementById("invitation-sounds-heading");
  focus?.focus({ preventScroll: true });
  focus?.scrollIntoView?.({ block: "center", behavior: "instant" });
}
