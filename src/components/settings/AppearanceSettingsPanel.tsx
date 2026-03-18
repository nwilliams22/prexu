import type { AppearancePreferences, Preferences } from "../../types/preferences";
import { styles } from "./settingsStyles";

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

interface AppearanceSettingsPanelProps {
  appearance: AppearancePreferences;
  updateAppearance: (partial: Partial<AppearancePreferences>) => void;
  updatePreferences: (partial: DeepPartial<Preferences>) => void;
}

export function AppearanceSettingsPanel({
  appearance: ap,
  updateAppearance,
  updatePreferences,
}: AppearanceSettingsPanelProps) {
  return (
    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>Appearance</h3>

      <div style={styles.field}>
        <label style={styles.label}>Poster Size</label>
        <div style={styles.radioGroup}>
          {(["small", "medium", "large"] as const).map((size) => (
            <label key={size} style={styles.radioLabel}>
              <input
                type="radio"
                name="posterSize"
                checked={ap.posterSize === size}
                onChange={() => updateAppearance({ posterSize: size })}
                style={styles.radio}
              />
              {size.charAt(0).toUpperCase() + size.slice(1)}
            </label>
          ))}
        </div>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Sidebar Default</label>
        <div style={styles.radioGroup}>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="sidebar"
              checked={!ap.sidebarCollapsed}
              onChange={() => updateAppearance({ sidebarCollapsed: false })}
              style={styles.radio}
            />
            Expanded
          </label>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="sidebar"
              checked={ap.sidebarCollapsed}
              onChange={() => updateAppearance({ sidebarCollapsed: true })}
              style={styles.radio}
            />
            Collapsed
          </label>
        </div>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Dashboard Sections</label>
        <div style={styles.checkboxGroup}>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={ap.dashboardSections.continueWatching}
              onChange={(e) =>
                updatePreferences({
                  appearance: {
                    dashboardSections: { continueWatching: e.target.checked },
                  },
                })
              }
              style={styles.checkbox}
            />
            Continue Watching
          </label>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={ap.dashboardSections.recentMovies}
              onChange={(e) =>
                updatePreferences({
                  appearance: {
                    dashboardSections: { recentMovies: e.target.checked },
                  },
                })
              }
              style={styles.checkbox}
            />
            Recently Added Movies
          </label>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={ap.dashboardSections.recentShows}
              onChange={(e) =>
                updatePreferences({
                  appearance: {
                    dashboardSections: { recentShows: e.target.checked },
                  },
                })
              }
              style={styles.checkbox}
            />
            Recently Added TV Shows
          </label>
        </div>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>TV Show Navigation</label>
        <div style={styles.checkboxGroup}>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={ap.skipSingleSeason}
              onChange={(e) =>
                updateAppearance({ skipSingleSeason: e.target.checked })
              }
              style={styles.checkbox}
            />
            Skip seasons page for single-season shows
          </label>
        </div>
        <p style={styles.hint}>
          When enabled, shows with only one season go directly to the episode
          list instead of showing a seasons page.
        </p>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Minimum Collection Size</label>
        <select
          value={ap.minCollectionSize}
          onChange={(e) =>
            updateAppearance({ minCollectionSize: Number(e.target.value) })
          }
          style={styles.select}
        >
          {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
            <option key={n} value={n}>
              {n} items
            </option>
          ))}
        </select>
        <p style={styles.hint}>
          Collections with fewer items than this will be hidden from the
          collections browser and library view.
        </p>
      </div>
    </section>
  );
}
