import { useSyncExternalStore } from "react";
import type { PlaybackPreferences } from "../../types/preferences";
import { IS_NATIVE_PLAYER_PLATFORM, isSessionFallbackActive, subscribeToEngineFallback } from "../../hooks/player/engineResolution";
import { PreferenceRow } from "./PreferenceRow";
import { SettingsSection } from "./SettingsPrimitives";

interface PlaybackSettingsPanelProps {
  playback: PlaybackPreferences;
  updatePlayback: (partial: Partial<PlaybackPreferences>) => void;
}

export function PlaybackSettingsPanel({ playback: pb, updatePlayback }: PlaybackSettingsPanelProps) {
  const fallback = useSyncExternalStore(subscribeToEngineFallback, isSessionFallbackActive);
  return <>
    <SettingsSection title="Video">
      {IS_NATIVE_PLAYER_PLATFORM ? <PreferenceRow path="playback.playerEngine" help={`Applies the next time you open the player.${fallback ? " HTML5 is in use after a player error. Your choice applies after restarting Prexu." : ""}`}>
        {(props) => <select {...props} value={pb.playerEngine} onChange={(e) => updatePlayback({ playerEngine: e.target.value as PlaybackPreferences["playerEngine"] })}>
          <option value="auto">Auto — native when available</option><option value="native">Native (mpv)</option><option value="html5">HTML5 (browser)</option>
        </select>}
      </PreferenceRow> : <p>Player: HTML5</p>}
      <PreferenceRow path="playback.quality" help="Direct play depends on format support and your Direct Play preference.">
        {(props) => <select {...props} value={pb.quality} onChange={(e) => updatePlayback({ quality: e.target.value as PlaybackPreferences["quality"] })}>
          <option value="original">Original quality</option><option value="1080p">1080p (20 Mbps)</option><option value="720p">720p (4 Mbps)</option><option value="480p">480p (2 Mbps)</option>
        </select>}
      </PreferenceRow>
      <PreferenceRow path="playback.directPlayPreference" help="Auto will direct play compatible files and transcode others.">
        {(props) => <select {...props} value={pb.directPlayPreference} onChange={(e) => updatePlayback({ directPlayPreference: e.target.value as PlaybackPreferences["directPlayPreference"] })}>
          <option value="auto">Auto</option><option value="always">Always try direct play</option><option value="never">Always transcode</option>
        </select>}
      </PreferenceRow>
    </SettingsSection>
    <SettingsSection title="Episodes">
      {([
        ["skipIntroEnabled", "Show Skip Intro button", 'Show a "Skip Intro" button during detected intro segments.'],
        ["skipCreditsEnabled", "Show Skip Credits button", 'Show a "Skip Credits" or "Next Episode" button during credits.'],
        ["autoPlayEnabled", "Play next episode automatically", "Start the next available episode after the countdown."],
      ] as const).map(([key, label, help]) => <PreferenceRow key={key} path={`playback.${key}`} label={label} help={help}>
        {(props) => <input {...props} type="checkbox" checked={pb[key]} onChange={(e) => updatePlayback({ [key]: e.target.checked })} />}
      </PreferenceRow>)}
    </SettingsSection>
  </>;
}
