import type { AppearancePreferences, Preferences } from "../../types/preferences";
import type { DeepPartial } from "../../hooks/preferencePersistence";
import { PreferenceRow } from "./PreferenceRow";
import { SettingsChoiceGroup, SettingsSection } from "./SettingsPrimitives";

interface AppearanceSettingsPanelProps {
  appearance: AppearancePreferences;
  updateAppearance: (partial: Partial<AppearancePreferences>) => void;
  updatePreferences: (partial: DeepPartial<Preferences>) => void;
}

export function AppearanceSettingsPanel({ appearance: ap, updateAppearance, updatePreferences }: AppearanceSettingsPanelProps) {
  return <>
    <SettingsSection title="Interface">
      <PreferenceRow path="appearance.theme" help="System follows your operating system's light/dark preference.">
        {(props) => <SettingsChoiceGroup {...props} legend="Theme" value={ap.theme} options={[{ value: "system", label: "System" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} onChange={(theme) => updateAppearance({ theme: theme as AppearancePreferences["theme"] })} />}
      </PreferenceRow>
      <PreferenceRow path="appearance.posterSize">
        {(props) => <SettingsChoiceGroup {...props} legend="Poster Size" value={ap.posterSize} options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]} onChange={(posterSize) => updateAppearance({ posterSize: posterSize as AppearancePreferences["posterSize"] })} />}
      </PreferenceRow>
      <PreferenceRow path="appearance.sidebarCollapsed" label="Sidebar default">
        {(props) => <SettingsChoiceGroup {...props} legend="Sidebar default" value={String(ap.sidebarCollapsed)} options={[{ value: "false", label: "Expanded" }, { value: "true", label: "Collapsed" }]} onChange={(value) => updateAppearance({ sidebarCollapsed: value === "true" })} />}
      </PreferenceRow>
    </SettingsSection>
    <SettingsSection title="Home" description="Hidden sections can be enabled here at any time.">
      <fieldset className="settings-dashboard-group"><legend>Dashboard sections</legend>
        {(["continueWatching", "recentMovies", "recentShows"] as const).map((key) => <PreferenceRow key={key} path={`appearance.dashboardSections.${key}`}>
          {(props) => <input {...props} type="checkbox" checked={ap.dashboardSections[key]} onChange={(e) => updatePreferences({ appearance: { dashboardSections: { [key]: e.target.checked } } })} />}
        </PreferenceRow>)}
      </fieldset>
    </SettingsSection>
    <SettingsSection title="Library browsing">
      <PreferenceRow path="appearance.skipSingleSeason" label="Skip seasons page for single-season shows">
        {(props) => <input {...props} type="checkbox" checked={ap.skipSingleSeason} onChange={(e) => updateAppearance({ skipSingleSeason: e.target.checked })} />}
      </PreferenceRow>
      <PreferenceRow path="appearance.minCollectionSize" help="Collections with fewer items than this will be hidden from the collections browser and library view.">
        {(props) => <select {...props} value={ap.minCollectionSize} onChange={(e) => updateAppearance({ minCollectionSize: Number(e.target.value) })}>
          {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} items</option>)}
        </select>}
      </PreferenceRow>
    </SettingsSection>
  </>;
}
