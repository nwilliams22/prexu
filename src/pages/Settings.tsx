import { useState } from "react";
import { PreferenceSaveContext, PreferenceFailures } from "../components/settings/PreferenceSaveStatus";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { SettingsShell, SETTINGS_CATEGORIES } from "../components/settings/SettingsShell";
import { useAuth } from "../hooks/useAuth";
import { useInvites } from "../hooks/useInvites";
import { usePreferences } from "../hooks/usePreferences";
import type { PlaybackPreferences, AppearancePreferences, SubtitleStylePreferences } from "../types/preferences";
import { PlaybackSettingsPanel } from "../components/settings/PlaybackSettingsPanel";
import { SubtitlesSettingsPanel } from "../components/settings/SubtitlesSettingsPanel";
import { AudioSettingsPanel } from "../components/settings/AudioSettingsPanel";
import { AppearanceSettingsPanel } from "../components/settings/AppearanceSettingsPanel";
import { ConnectionsSettingsPanel } from "../components/settings/ConnectionsSettingsPanel";
import { AboutSettingsPanel } from "../components/settings/AboutSettingsPanel";
import { SettingsDraftGuard } from "../components/settings/SettingsDraftGuard";
import { ParentalControlsPanel } from "../components/settings/ParentalControlsPanel";

function Settings() {
  const { server, activeUser } = useAuth();
  const { isRelayConnected, refreshInvites } = useInvites();
  const [deviceFailure, setDeviceFailure] = useState(false);
  const isAdmin = activeUser?.isAdmin ?? false;
  const preferenceState = usePreferences();
  const { preferences, updatePreferences, loadState, retryLoad } = preferenceState;

  const location = useLocation();
  const { "*": categoryPath } = useParams();
  const category = SETTINGS_CATEGORIES.find((item) => item.id === categoryPath);

  const pb = preferences.playback;
  const ap = preferences.appearance;

  const updatePlayback = (partial: Partial<PlaybackPreferences>) => {
    updatePreferences({ playback: partial });
  };

  const updateSubtitleStyle = (partial: Partial<SubtitleStylePreferences>) => {
    updatePreferences({
      playback: { subtitleStyle: partial },
    });
  };

  const updateAppearance = (partial: Partial<AppearancePreferences>) => {
    updatePreferences({ appearance: partial });
  };

  if (!category) return <Navigate to={`/settings/playback${location.search}`} replace />;

  return (
    <SettingsDraftGuard>
    <PreferenceSaveContext value={preferenceState}>
      <SettingsShell profileName={activeUser?.title} category={category.id} isAdmin={isAdmin} headerContent={<><PreferenceFailures />{deviceFailure && <p role="status">Some changes are not saved. <Link to="/settings/connections#N2-row">Review invitation sounds</Link></p>}</>}>
        {loadState === "error" && <div role="alert"><p>Could not load settings</p><button type="button" onClick={retryLoad}>Retry</button></div>}
        {loadState === "loading" && <div role="status" aria-label="Loading settings" className="settings-loading"><div /><div /><div /></div>}
        <fieldset disabled={loadState !== "ready"} aria-busy={loadState === "loading"} className="settings-preference-fields">
        <div hidden={category.id !== "playback"}>
          <PlaybackSettingsPanel playback={pb} updatePlayback={updatePlayback} />
        </div>
        <div hidden={category.id !== "subtitles"}>
          <SubtitlesSettingsPanel playback={pb} updatePlayback={updatePlayback} updateSubtitleStyle={updateSubtitleStyle} />
        </div>
        <div hidden={category.id !== "audio"}>
          <AudioSettingsPanel playback={pb} updatePlayback={updatePlayback} />
        </div>
        <div hidden={category.id !== "appearance"}>
          <AppearanceSettingsPanel
            appearance={ap}
            updateAppearance={updateAppearance}
            updatePreferences={updatePreferences}
          />
        </div>
        </fieldset>
        {category.id === "parental-controls" && <ParentalControlsPanel isAdmin={isAdmin} />}
        <div hidden={category.id !== "connections"}>
          <ConnectionsSettingsPanel serverUri={server?.uri} isRelayConnected={isRelayConnected} refreshInvites={refreshInvites} onFailureChange={setDeviceFailure} />
        </div>
        {category.id === "about" && <AboutSettingsPanel serverUri={server?.uri} isAdmin={isAdmin} />}
      </SettingsShell>
    </PreferenceSaveContext>
    </SettingsDraftGuard>
  );
}

export default Settings;
