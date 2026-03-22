import type { PlaybackPreferences } from "../../types/preferences";
import { LANGUAGES } from "../../constants/languages";
import { styles } from "./settingsStyles";

interface PlaybackSettingsPanelProps {
  playback: PlaybackPreferences;
  updatePlayback: (partial: Partial<PlaybackPreferences>) => void;
}

export function PlaybackSettingsPanel({ playback: pb, updatePlayback }: PlaybackSettingsPanelProps) {
  return (
    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>Playback</h3>

      <div style={styles.field}>
        <label style={styles.label}>Video Quality</label>
        <select
          value={pb.quality}
          onChange={(e) => updatePlayback({ quality: e.target.value as PlaybackPreferences["quality"] })}
          style={styles.select}
        >
          <option value="original">Original (Direct Play)</option>
          <option value="1080p">1080p (20 Mbps)</option>
          <option value="720p">720p (4 Mbps)</option>
          <option value="480p">480p (2 Mbps)</option>
        </select>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Direct Play Preference</label>
        <p style={styles.hint}>
          Auto will direct play compatible files and transcode others.
        </p>
        <select
          value={pb.directPlayPreference}
          onChange={(e) => updatePlayback({ directPlayPreference: e.target.value as PlaybackPreferences["directPlayPreference"] })}
          style={styles.select}
        >
          <option value="auto">Auto</option>
          <option value="always">Always try direct play</option>
          <option value="never">Always transcode</option>
        </select>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Skip Intro</label>
        <p style={styles.hint}>
          Show a "Skip Intro" button during detected intro segments.
        </p>
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={pb.skipIntroEnabled}
            onChange={(e) => updatePlayback({ skipIntroEnabled: e.target.checked })}
          />
          Enable skip intro button
        </label>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Skip Credits</label>
        <p style={styles.hint}>
          Show a "Skip Credits" or "Next Episode" button during credits.
        </p>
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={pb.skipCreditsEnabled}
            onChange={(e) => updatePlayback({ skipCreditsEnabled: e.target.checked })}
          />
          Enable skip credits button
        </label>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Preferred Audio Language</label>
        <select
          value={pb.preferredAudioLanguage}
          onChange={(e) => updatePlayback({ preferredAudioLanguage: e.target.value })}
          style={styles.select}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </div>
    </section>
  );
}
