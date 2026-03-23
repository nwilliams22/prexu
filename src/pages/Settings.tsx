import { useAuth } from "../hooks/useAuth";
import { useInvites } from "../hooks/useInvites";
import { usePreferences } from "../hooks/usePreferences";
import type { PlaybackPreferences, AppearancePreferences, SubtitleStylePreferences } from "../types/preferences";
import { PlaybackSettingsPanel } from "../components/settings/PlaybackSettingsPanel";
import { SubtitleStylePanel } from "../components/settings/SubtitleStylePanel";
import { AccessibilitySettingsPanel } from "../components/settings/AccessibilitySettingsPanel";
import { AudioSettingsPanel } from "../components/settings/AudioSettingsPanel";
import { AppearanceSettingsPanel } from "../components/settings/AppearanceSettingsPanel";
import { AccountSettingsPanel } from "../components/settings/AccountSettingsPanel";
import { ParentalControlsPanel } from "../components/settings/ParentalControlsPanel";

function Settings() {
  const { server, activeUser } = useAuth();
  const { isRelayConnected, refreshInvites } = useInvites();
  const isAdmin = activeUser?.isAdmin ?? false;
  const { preferences, updatePreferences } = usePreferences();

  const pb = preferences.playback;
  const ap = preferences.appearance;

  const updatePlayback = (partial: Partial<PlaybackPreferences>) => {
    updatePreferences({ playback: partial });
  };

  const updateSubtitleStyle = (partial: Partial<SubtitleStylePreferences>) => {
    updatePreferences({
      playback: { subtitleStyle: { ...pb.subtitleStyle, ...partial } },
    });
  };

  const updateAppearance = (partial: Partial<AppearancePreferences>) => {
    updatePreferences({ appearance: partial });
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Settings</h2>

      <PlaybackSettingsPanel playback={pb} updatePlayback={updatePlayback} />
      <SubtitleStylePanel subtitleStyle={pb.subtitleStyle} updateSubtitleStyle={updateSubtitleStyle} />
      <AccessibilitySettingsPanel playback={pb} updatePlayback={updatePlayback} />
      <AudioSettingsPanel playback={pb} updatePlayback={updatePlayback} />
      <AppearanceSettingsPanel
        appearance={ap}
        updateAppearance={updateAppearance}
        updatePreferences={updatePreferences}
      />
      {isAdmin && <ParentalControlsPanel />}
      <AccountSettingsPanel
        serverUri={server?.uri}
        isAdmin={isAdmin}
        isRelayConnected={isRelayConnected}
        refreshInvites={refreshInvites}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
    maxWidth: "600px",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    marginBottom: "1.5rem",
  },
};

export default Settings;
