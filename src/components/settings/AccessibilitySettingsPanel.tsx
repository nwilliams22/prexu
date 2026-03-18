import type { PlaybackPreferences } from "../../types/preferences";
import { LANGUAGES } from "../../constants/languages";
import { styles } from "./settingsStyles";

interface AccessibilitySettingsPanelProps {
  playback: PlaybackPreferences;
  updatePlayback: (partial: Partial<PlaybackPreferences>) => void;
}

export function AccessibilitySettingsPanel({ playback: pb, updatePlayback }: AccessibilitySettingsPanelProps) {
  return (
    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>Subtitles</h3>

      <div style={styles.field}>
        <label style={styles.label}>Default Subtitles</label>
        <select
          value={pb.defaultSubtitles}
          onChange={(e) => updatePlayback({ defaultSubtitles: e.target.value as PlaybackPreferences["defaultSubtitles"] })}
          style={styles.select}
        >
          <option value="auto">Auto (use server default)</option>
          <option value="always">Always on</option>
          <option value="off">Off</option>
        </select>
      </div>

      {pb.defaultSubtitles !== "off" && (
        <div style={styles.field}>
          <label style={styles.label}>Preferred Subtitle Language</label>
          <select
            value={pb.preferredSubtitleLanguage}
            onChange={(e) => updatePlayback({ preferredSubtitleLanguage: e.target.value })}
            style={styles.select}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      )}

      <div style={styles.field}>
        <label style={styles.label}>
          Subtitle Size: {pb.subtitleSize}%
        </label>
        <input
          type="range"
          min={50}
          max={200}
          step={10}
          value={pb.subtitleSize}
          onChange={(e) => updatePlayback({ subtitleSize: Number(e.target.value) })}
          style={styles.slider}
        />
        <div style={styles.sliderLabels}>
          <span>Small</span>
          <span>Normal</span>
          <span>Large</span>
        </div>
      </div>
    </section>
  );
}
