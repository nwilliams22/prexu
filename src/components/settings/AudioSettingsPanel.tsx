import { LANGUAGES } from "../../constants/languages";
import type { PlaybackPreferences } from "../../types/preferences";
import { PreferenceRow } from "./PreferenceRow";
import { SettingsRange, SettingsSection } from "./SettingsPrimitives";

interface AudioSettingsPanelProps {
  playback: PlaybackPreferences;
  updatePlayback: (partial: Partial<PlaybackPreferences>) => void;
}

export function AudioSettingsPanel({ playback: pb, updatePlayback }: AudioSettingsPanelProps) {
  return <>
    <SettingsSection title="Language">
      <PreferenceRow path="playback.preferredAudioLanguage">
        {(props) => <select {...props} value={pb.preferredAudioLanguage} onChange={(e) => updatePlayback({ preferredAudioLanguage: e.target.value })}>
          {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.code ? language.label : "No preference"}</option>)}
        </select>}
      </PreferenceRow>
    </SettingsSection>
    <SettingsSection title="Loudness">
      <PreferenceRow path="playback.audioBoost" label="Transcode audio boost" help="Applied by the server during transcoding.">
        {(props) => <SettingsRange {...props} min={0} max={200} step={10} value={pb.audioBoost} formatValue={(n) => `${n}%`} onChange={(e) => updatePlayback({ audioBoost: Number(e.target.value) })} />}
      </PreferenceRow>
      <PreferenceRow path="playback.volumeBoost" label="Playback volume boost" help="Amplifies playback audio. Values above 200% may distort.">
        {(props) => <SettingsRange {...props} min={100} max={500} step={25} value={Math.round(pb.volumeBoost * 100)} formatValue={(n) => `${n}%`} onChange={(e) => updatePlayback({ volumeBoost: Number(e.target.value) / 100 })} />}
      </PreferenceRow>
      <PreferenceRow path="playback.normalizationPreset" help="Brings quiet dialogue and loud effects closer in volume. Night Mode applies stronger compression.">
        {(props) => <select {...props} value={pb.normalizationPreset} onChange={(e) => updatePlayback({ normalizationPreset: e.target.value as PlaybackPreferences["normalizationPreset"] })}>
          <option value="off">Off</option><option value="light">Light</option><option value="night">Night Mode</option>
        </select>}
      </PreferenceRow>
    </SettingsSection>
    <SettingsSection title="Timing">
      <PreferenceRow path="playback.audioOffsetMs" label="Audio delay" help="Increase when audio plays before video.">
        {(props) => <SettingsRange {...props} min={0} max={500} step={10} value={pb.audioOffsetMs} formatValue={(n) => `${n}ms`} onChange={(e) => updatePlayback({ audioOffsetMs: Number(e.target.value) })} />}
      </PreferenceRow>
    </SettingsSection>
  </>;
}
