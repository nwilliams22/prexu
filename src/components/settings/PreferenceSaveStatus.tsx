import { createContext, useContext, useLayoutEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import type { PreferencesContextValue } from "../../hooks/usePreferences";
import type { PreferencePath } from "../../hooks/preferencePersistence";

// Optional so the shared subtitle panel still works in the player popup and
// panels can be rendered independently. Settings provides the real store.
export const PreferenceSaveContext = createContext<PreferencesContextValue | null>(null);
export const preferenceRows = {
  "playback.playerEngine": ["P1", "playback", "Player Engine"],
  "playback.quality": ["P2", "playback", "Video Quality"],
  "playback.directPlayPreference": ["P3", "playback", "Direct Play Preference"],
  "playback.skipIntroEnabled": ["P4", "playback", "Skip Intro"],
  "playback.skipCreditsEnabled": ["P5", "playback", "Skip Credits"],
  "playback.autoPlayEnabled": ["P6", "playback", "Auto-play Next Episode"],
  "playback.preferredAudioLanguage": ["P7", "audio", "Preferred Audio Language"],
  "playback.defaultSubtitles": ["L1", "subtitles", "Default Subtitles"],
  "playback.preferredSubtitleLanguage": ["L2", "subtitles", "Preferred Subtitle Language"],
  "playback.subtitleSize": ["L3", "subtitles", "Subtitle Size"],
  "playback.subtitleStyle.fontFamily": ["S1", "subtitles", "Font"],
  "playback.subtitleStyle.textColor": ["S2", "subtitles", "Text Color"],
  "playback.subtitleStyle.backgroundColor": ["S3", "subtitles", "Background Color"],
  "playback.subtitleStyle.backgroundOpacity": ["S4", "subtitles", "Background Opacity"],
  "playback.subtitleStyle.outlineColor": ["S5", "subtitles", "Outline Color"],
  "playback.subtitleStyle.outlineWidth": ["S6", "subtitles", "Outline Width"],
  "playback.subtitleStyle.shadowEnabled": ["S7", "subtitles", "Drop shadow"],
  "playback.audioBoost": ["A1", "audio", "Audio Boost"],
  "playback.volumeBoost": ["A2", "audio", "Volume Boost"],
  "playback.normalizationPreset": ["A3", "audio", "Audio Normalization"],
  "playback.audioOffsetMs": ["A4", "audio", "Audio Offset"],
  "appearance.theme": ["V1", "appearance", "Theme"],
  "appearance.posterSize": ["V2", "appearance", "Poster Size"],
  "appearance.sidebarCollapsed": ["V3", "appearance", "Sidebar Default"],
  "appearance.dashboardSections.continueWatching": ["V4", "appearance", "Continue Watching"],
  "appearance.dashboardSections.recentMovies": ["V5", "appearance", "Recently Added Movies"],
  "appearance.dashboardSections.recentShows": ["V6", "appearance", "Recently Added TV Shows"],
  "appearance.skipSingleSeason": ["V7", "appearance", "TV Show Navigation"],
  "appearance.minCollectionSize": ["V8", "appearance", "Minimum Collection Size"],
} satisfies Record<PreferencePath, readonly [string, string, string]>;

function focusRow(id: string) {
  const feedback = document.getElementById(id);
  if (!feedback) return;
  const row = feedback.closest(".settings-row") ?? feedback.parentElement;
  const control = row?.querySelector<HTMLElement>(`input[aria-describedby~="${id}"]:not(:disabled), select[aria-describedby~="${id}"]:not(:disabled)`);
  (control ?? row?.querySelector<HTMLElement>("label[tabindex]") ?? feedback).focus({ preventScroll: true });
  row?.scrollIntoView?.({ block: "center", behavior: "instant" });
}

export function PreferenceSaveStatus({ path }: { path: PreferencePath }) {
  const store = useContext(PreferenceSaveContext);
  if (!store) return null;
  const state = store.saveStates[path];
  const [id, , label] = preferenceRows[path];
  return <div id={`preference-${id}`} tabIndex={-1} className="preference-save-status">
    <span role="status">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : ""}</span>
    {state === "error" && <>
      <button type="button" aria-label={`Retry ${label}`} onClick={() => { focusRow(`preference-${id}`); store.retryPreference(path); }}>Retry</button>
      <button type="button" aria-label={`Revert ${label}`} onClick={() => { focusRow(`preference-${id}`); store.revertPreference(path); }}>Revert</button>
    </>}
  </div>;
}

export function PreferenceFailures() {
  const store = useContext(PreferenceSaveContext);
  const location = useLocation();
  useLayoutEffect(() => {
    if (location.hash.startsWith("#preference-")) focusRow(location.hash.slice(1));
  }, [location.pathname, location.hash]);
  const failed = (Object.keys(store?.saveStates ?? {}) as PreferencePath[]).filter((path) => store?.saveStates[path] === "error");
  if (!failed.length) return null;
  return <div className="settings-error">
    <p role="status">Some changes are not saved</p>
    <ul>{failed.map((path) => {
      const [id, category, label] = preferenceRows[path];
      return <li key={path}><Link to={`/settings/${category}#preference-${id}`} onClick={() => {
        if (location.pathname === `/settings/${category}`) focusRow(`preference-${id}`);
      }}>{label}</Link></li>;
    })}</ul>
  </div>;
}
