import { PreferenceSaveStatus } from "./PreferenceSaveStatus";
import { SettingsRow } from "./SettingsPrimitives";
import { LANGUAGES } from "../../constants/languages";
import type { PlaybackPreferences, NormalizationPreset } from "../../types/preferences";
import { styles } from "./settingsStyles";

interface AudioSettingsPanelProps {
  playback: PlaybackPreferences;
  updatePlayback: (partial: Partial<PlaybackPreferences>) => void;
}

export function AudioSettingsPanel({ playback: pb, updatePlayback }: AudioSettingsPanelProps) {
  return (
    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>Audio</h3>

      <SettingsRow id="preferred-audio-language" label="Preferred Audio Language" status={<PreferenceSaveStatus path="playback.preferredAudioLanguage" />}>
        {(props) => <select {...props} aria-describedby={`${props["aria-describedby"]} preference-P7`}
          value={pb.preferredAudioLanguage}
          onChange={(event) => updatePlayback({ preferredAudioLanguage: event.target.value })}
        >
          {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.code ? language.label : "No preference"}</option>)}
        </select>}
      </SettingsRow>

      <div style={styles.field}>
        <label style={styles.label}>
          Audio Boost: {pb.audioBoost}%
        </label>
        <p style={styles.hint}>
          Server-side audio boost applied during transcoding.
        </p>
        <input aria-describedby="preference-A1"
          type="range"
          min={0}
          max={200}
          step={10}
          value={pb.audioBoost}
          onChange={(e) => updatePlayback({ audioBoost: Number(e.target.value) })}
          style={styles.slider}
        />
        <div style={styles.sliderLabels}>
          <span>Off</span>
          <span>Normal</span>
          <span>Max</span>
        </div>
        <PreferenceSaveStatus path="playback.audioBoost" />
      </div>

      <div style={styles.field}>
        <label style={styles.label}>
          Volume Boost: {Math.round(pb.volumeBoost * 100)}%
        </label>
        <p style={styles.hint}>
          Client-side amplification via Web Audio API. Values above 200% may
          cause distortion with some audio tracks.
        </p>
        <input aria-describedby="preference-A2"
          type="range"
          min={100}
          max={500}
          step={25}
          value={Math.round(pb.volumeBoost * 100)}
          onChange={(e) => updatePlayback({ volumeBoost: Number(e.target.value) / 100 })}
          style={styles.slider}
        />
        <div style={styles.sliderLabels}>
          <span>100%</span>
          <span>300%</span>
          <span>500%</span>
        </div>
        <PreferenceSaveStatus path="playback.volumeBoost" />
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Audio Normalization</label>
        <p style={styles.hint}>
          Compresses dynamic range so quiet dialogue and loud effects are
          closer in volume. Night mode is more aggressive for late-night viewing.
        </p>
        <select aria-describedby="preference-A3"
          value={pb.normalizationPreset}
          onChange={(e) => updatePlayback({ normalizationPreset: e.target.value as NormalizationPreset })}
          style={styles.select}
        >
          <option value="off">Off</option>
          <option value="light">Light</option>
          <option value="night">Night Mode</option>
        </select>
        <PreferenceSaveStatus path="playback.normalizationPreset" />
      </div>

      <div style={styles.field}>
        <label style={styles.label}>
          Audio Offset: {pb.audioOffsetMs}ms
        </label>
        <p style={styles.hint}>
          Delays audio playback to fix lip-sync issues. Increase if audio
          plays before the video.
        </p>
        <input aria-describedby="preference-A4"
          type="range"
          min={0}
          max={500}
          step={10}
          value={pb.audioOffsetMs}
          onChange={(e) => updatePlayback({ audioOffsetMs: Number(e.target.value) })}
          style={styles.slider}
        />
        <div style={styles.sliderLabels}>
          <span>0ms</span>
          <span>250ms</span>
          <span>500ms</span>
        </div>
        <PreferenceSaveStatus path="playback.audioOffsetMs" />
      </div>
    </section>
  );
}
