import { useState, useEffect } from "react";
import {
  getRelayUrl,
  saveRelayUrl,
  clearRelayUrl,
  hasManualRelayUrl,
  deriveRelayUrl,
} from "../services/storage";
import { useAuth } from "../hooks/useAuth";
import { useInvites } from "../hooks/useInvites";

function Settings() {
  const { server } = useAuth();
  const { isRelayConnected, refreshInvites } = useInvites();

  const [manualUrl, setManualUrl] = useState("");
  const [hasOverride, setHasOverride] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [saved, setSaved] = useState(false);

  const autoUrl = server?.uri ? deriveRelayUrl(server.uri) : null;

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
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    refreshInvites();
  };

  const handleResetToAuto = async () => {
    await clearRelayUrl();
    setHasOverride(false);
    setShowOverride(false);
    setManualUrl("");
    setSaved(false);
    refreshInvites();
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Settings</h2>

      {/* Watch Together section */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Watch Together</h3>

        <div style={styles.field}>
          <label style={styles.label}>Relay Server</label>
          <p style={styles.description}>
            The relay server coordinates Watch Together sessions. By default,
            Prexu auto-detects the relay from your Plex server address — no
            configuration needed.
          </p>

          {/* Auto-derived URL display */}
          <div style={styles.autoRow}>
            <span style={styles.autoLabel}>
              {hasOverride ? "Auto-detected:" : "Connected via:"}
            </span>
            <code style={styles.autoUrl}>
              {autoUrl ?? "No server selected"}
            </code>
            {!hasOverride && (
              <span style={styles.autoBadge}>Auto</span>
            )}
          </div>

          {/* Connection status */}
          <div style={styles.statusRow}>
            <div
              style={{
                ...styles.statusDot,
                background: isRelayConnected ? "#4caf50" : "#ef4444",
              }}
            />
            <span style={styles.statusText}>
              {isRelayConnected ? "Connected to relay" : "Not connected"}
            </span>
          </div>

          {/* Manual override section */}
          {!showOverride ? (
            <button
              onClick={() => setShowOverride(true)}
              style={styles.overrideToggle}
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
                  {saved ? "Saved!" : "Save"}
                </button>
              </div>
              {hasOverride && (
                <button
                  onClick={handleResetToAuto}
                  style={styles.resetButton}
                >
                  Reset to auto-detect
                </button>
              )}
              {!hasOverride && (
                <button
                  onClick={() => setShowOverride(false)}
                  style={styles.resetButton}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </section>
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
  section: {
    marginBottom: "2rem",
  },
  sectionTitle: {
    fontSize: "1.1rem",
    fontWeight: 600,
    marginBottom: "1rem",
    color: "var(--accent)",
  },
  field: {
    marginBottom: "1rem",
  },
  label: {
    fontSize: "0.9rem",
    fontWeight: 500,
    marginBottom: "0.25rem",
    display: "block",
  },
  description: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    marginBottom: "0.75rem",
    lineHeight: 1.4,
  },
  autoRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.5rem",
  },
  autoLabel: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
  },
  autoUrl: {
    fontSize: "0.8rem",
    color: "var(--text-primary)",
    background: "var(--bg-card)",
    padding: "0.2rem 0.5rem",
    borderRadius: "4px",
    fontFamily: "monospace",
  },
  autoBadge: {
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "#000",
    background: "var(--accent)",
    padding: "0.1rem 0.4rem",
    borderRadius: "4px",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.75rem",
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
  },
  statusText: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
  },
  overrideToggle: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    fontSize: "0.8rem",
    textDecoration: "underline",
    cursor: "pointer",
    padding: 0,
  },
  overrideSection: {
    marginTop: "0.5rem",
    padding: "0.75rem",
    background: "var(--bg-card)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
  },
  overrideLabel: {
    fontSize: "0.85rem",
    fontWeight: 500,
    marginBottom: "0.5rem",
    display: "block",
  },
  inputRow: {
    display: "flex",
    gap: "0.5rem",
  },
  input: {
    flex: 1,
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: "0.9rem",
    outline: "none",
  },
  saveButton: {
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "6px",
    padding: "0.5rem 1rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  resetButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    fontSize: "0.8rem",
    textDecoration: "underline",
    cursor: "pointer",
    padding: 0,
    marginTop: "0.5rem",
    display: "block",
  },
};

export default Settings;
