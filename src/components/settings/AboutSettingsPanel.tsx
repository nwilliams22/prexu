import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { SettingsSection } from "./SettingsPrimitives";
import { settingsAddress } from "./settingsAddress";

export function AboutSettingsPanel({ serverUri, isAdmin }: { serverUri?: string; isAdmin: boolean }) {
  const [error, setError] = useState(false);
  async function openLink(url: string) {
    setError(false);
    try { await open(url); } catch { setError(true); }
  }
  const platform = navigator.userAgent.includes("Windows") ? "Windows" : navigator.userAgent.includes("Mac") ? "macOS" : navigator.userAgent.includes("Linux") ? "Linux" : "Unknown";
  return <>
    <SettingsSection id="about-app" title="Prexu">
      <p id="about-version" tabIndex={-1}>v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.1.0"}</p>
      <p>A custom cross-platform Plex client.</p>
      <dl><dt id="about-platform" tabIndex={-1}>Platform</dt><dd>{platform}</dd><dt id="about-server" tabIndex={-1}>Server</dt><dd>{serverUri ? settingsAddress(serverUri) : "No server selected"}</dd></dl>
      <div className="settings-actions">
        <button id="about-report-bug" onClick={() => void openLink("https://github.com/nwilliams22/prexu/issues/new")}>Report a bug</button>
        <button id="about-github" onClick={() => void openLink("https://github.com/nwilliams22/prexu")}>GitHub</button>
      </div>
      {error && <p role="alert" className="settings-error">Could not open the link. Try again.</p>}
    </SettingsSection>
    {isAdmin && <SettingsSection id="about-content-search" title="Content search">
      <p>Content search uses the relay. Ask the relay administrator to enable search if it is unavailable.</p>
      <details><summary id="about-relay-setup">Relay administrator setup</summary><p>Set <code>TMDB_API_KEY</code> on the relay to enable content search.</p></details>
    </SettingsSection>}
  </>;
}
