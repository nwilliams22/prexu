import { PreferenceSaveStatus } from "./PreferenceSaveStatus";
import type { PlaybackPreferences } from "../../types/preferences";
import { IS_NATIVE_PLAYER_PLATFORM } from "../../hooks/player/engineResolution";
import { styles } from "./settingsStyles";

interface PlaybackSettingsPanelProps {
  playback: PlaybackPreferences;
  updatePlayback: (partial: Partial<PlaybackPreferences>) => void;
}

export function PlaybackSettingsPanel({ playback: pb, updatePlayback }: PlaybackSettingsPanelProps) {
  return (
    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>Playback</h3>

      {/* Only shown when this platform can even run the native (mpv)
          backend — Tauri desktop on Windows or Linux. Browser/web builds
          never see this control since HTML5 is their only option. */}
      {IS_NATIVE_PLAYER_PLATFORM && (
        <div style={styles.field}>
          <label style={styles.label}>Player Engine</label>
          <p style={styles.hint}>
            Changing this applies the next time you open the player.
          </p>
          <select aria-describedby="preference-P1"
            value={pb.playerEngine}
            onChange={(e) => updatePlayback({ playerEngine: e.target.value as PlaybackPreferences["playerEngine"] })}
            style={styles.select}
          >
            <option value="auto">Auto — native when available</option>
            <option value="native">Native (mpv)</option>
            <option value="html5">HTML5 (browser)</option>
          </select>
          <PreferenceSaveStatus path="playback.playerEngine" />
        </div>
      )}

      <div style={styles.field}>
        <label style={styles.label}>Video Quality</label>
        <select aria-describedby="preference-P2"
          value={pb.quality}
          onChange={(e) => updatePlayback({ quality: e.target.value as PlaybackPreferences["quality"] })}
          style={styles.select}
        >
          <option value="original">Original (Direct Play)</option>
          <option value="1080p">1080p (20 Mbps)</option>
          <option value="720p">720p (4 Mbps)</option>
          <option value="480p">480p (2 Mbps)</option>
        </select>
        <PreferenceSaveStatus path="playback.quality" />
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Direct Play Preference</label>
        <p style={styles.hint}>
          Auto will direct play compatible files and transcode others.
        </p>
        <select aria-describedby="preference-P3"
          value={pb.directPlayPreference}
          onChange={(e) => updatePlayback({ directPlayPreference: e.target.value as PlaybackPreferences["directPlayPreference"] })}
          style={styles.select}
        >
          <option value="auto">Auto</option>
          <option value="always">Always try direct play</option>
          <option value="never">Always transcode</option>
        </select>
        <PreferenceSaveStatus path="playback.directPlayPreference" />
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Skip Intro</label>
        <p style={styles.hint}>
          Show a "Skip Intro" button during detected intro segments.
        </p>
        <label style={styles.checkboxLabel}>
          <input aria-describedby="preference-P4"
            type="checkbox"
            checked={pb.skipIntroEnabled}
            onChange={(e) => updatePlayback({ skipIntroEnabled: e.target.checked })}
          />
          Enable skip intro button
        </label>
        <PreferenceSaveStatus path="playback.skipIntroEnabled" />
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Skip Credits</label>
        <p style={styles.hint}>
          Show a "Skip Credits" or "Next Episode" button during credits.
        </p>
        <label style={styles.checkboxLabel}>
          <input aria-describedby="preference-P5"
            type="checkbox"
            checked={pb.skipCreditsEnabled}
            onChange={(e) => updatePlayback({ skipCreditsEnabled: e.target.checked })}
          />
          Enable skip credits button
        </label>
        <PreferenceSaveStatus path="playback.skipCreditsEnabled" />
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Auto-play Next Episode</label>
        <p style={styles.hint}>
          When an episode ends, automatically start the next one after a short countdown.
        </p>
        <label style={styles.checkboxLabel}>
          <input aria-describedby="preference-P6"
            type="checkbox"
            checked={pb.autoPlayEnabled}
            onChange={(e) => updatePlayback({ autoPlayEnabled: e.target.checked })}
          />
          Enable auto-play
        </label>
        <PreferenceSaveStatus path="playback.autoPlayEnabled" />
      </div>
    </section>
  );
}
