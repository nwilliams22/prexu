import { useState, useEffect } from "react";
import {
  getRelayUrl,
  saveRelayUrl,
  clearRelayUrl,
  hasManualRelayUrl,
  deriveRelayUrl,
} from "../../services/storage";
import { open } from "@tauri-apps/plugin-shell";
import { styles } from "./settingsStyles";

interface AccountSettingsPanelProps {
  serverUri: string | undefined;
  isAdmin: boolean;
  isRelayConnected: boolean;
  refreshInvites: () => void;
}

export function AccountSettingsPanel({
  serverUri,
  isAdmin,
  isRelayConnected,
  refreshInvites,
}: AccountSettingsPanelProps) {
  const [manualUrl, setManualUrl] = useState("");
  const [hasOverride, setHasOverride] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [relaySaved, setRelaySaved] = useState(false);

  const autoUrl = serverUri ? deriveRelayUrl(serverUri) : null;

  useEffect(() => {
    (async () => {
      const isManual = await hasManualRelayUrl();
      setHasOverride(isManual);
      setShowOverride(isManual);
      if (isManual) {
        const url = await getRelayUrl();
        setManualUrl(url);
      }
    })();
  }, []);

  const handleSaveOverride = async () => {
    await saveRelayUrl(manualUrl);
    setHasOverride(true);
    setRelaySaved(true);
    setTimeout(() => setRelaySaved(false), 2000);
    refreshInvites();
  };

  const handleResetToAuto = async () => {
    await clearRelayUrl();
    setHasOverride(false);
    setShowOverride(false);
    setManualUrl("");
    setRelaySaved(false);
    refreshInvites();
  };

  return (
    <>
      {/* Watch Together */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Watch Together</h3>

        <div style={styles.field}>
          <label style={styles.label}>Relay Server</label>
          <p style={styles.hint}>
            The relay server coordinates Watch Together sessions. By default,
            Prexu auto-detects the relay from your Plex server address.
          </p>

          <div style={styles.autoRow}>
            <span style={styles.autoLabel}>
              {hasOverride ? "Auto-detected:" : "Connected via:"}
            </span>
            <code style={styles.autoUrl}>
              {autoUrl ?? "No server selected"}
            </code>
            {!hasOverride && <span style={styles.autoBadge}>Auto</span>}
          </div>

          <div style={styles.statusRow}>
            <div
              style={{
                ...styles.statusDot,
                background: isRelayConnected ? "var(--success)" : "var(--error)",
              }}
            />
            <span style={styles.statusText}>
              {isRelayConnected ? "Connected to relay" : "Not connected"}
            </span>
          </div>

          {!showOverride ? (
            <button
              onClick={() => setShowOverride(true)}
              style={styles.linkButton}
            >
              Use custom relay URL
            </button>
          ) : (
            <div style={styles.overrideSection}>
              <label style={styles.overrideLabel}>Custom Relay URL</label>
              <div style={styles.inputRow}>
                <input
                  type="text"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="ws://your-server:9847/ws"
                  style={styles.input}
                />
                <button onClick={handleSaveOverride} style={styles.saveButton}>
                  {relaySaved ? "Saved!" : "Save"}
                </button>
              </div>
              {hasOverride && (
                <button onClick={handleResetToAuto} style={styles.linkButton}>
                  Reset to auto-detect
                </button>
              )}
              {!hasOverride && (
                <button
                  onClick={() => setShowOverride(false)}
                  style={styles.linkButton}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Content Requests (Admin only) */}
      {isAdmin && (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Content Requests</h3>
          <p style={styles.hint}>
            Content search is powered by TMDb via the relay server.
            The relay server admin must set the TMDB_API_KEY environment
            variable to enable search functionality.
          </p>
        </section>
      )}

      {/* About */}
      <section style={{ ...styles.section, borderBottom: "none" }}>
        <h3 style={styles.sectionTitle}>About</h3>
        <div style={styles.aboutRow}>
          <span style={styles.aboutLabel}>Prexu</span>
          <span style={styles.aboutVersion}>v0.1.0</span>
        </div>
        <p style={styles.hint}>A custom cross-platform Plex client.</p>
        <button
          onClick={() => open("https://github.com/nwilliams22/prexu/issues/new")}
          style={styles.bugButton}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ marginRight: "0.4rem" }}>
            <circle cx={12} cy={12} r={10} />
            <line x1={12} y1={8} x2={12} y2={12} />
            <line x1={12} y1={16} x2={12.01} y2={16} />
          </svg>
          Report a Bug
        </button>
      </section>
    </>
  );
}
