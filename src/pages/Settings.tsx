import { useState, useEffect } from "react";
import { getRelayUrl, saveRelayUrl } from "../services/storage";
import { useInvites } from "../hooks/useInvites";

function Settings() {
  const [relayUrl, setRelayUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const { isRelayConnected, refreshInvites } = useInvites();

  useEffect(() => {
    (async () => {
      const url = await getRelayUrl();
      setRelayUrl(url);
    })();
  }, []);

  const handleSave = async () => {
    await saveRelayUrl(relayUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    // Reconnect to the new URL
    refreshInvites();
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Settings</h2>

      {/* Watch Together section */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Watch Together</h3>

        <div style={styles.field}>
          <label style={styles.label}>Relay Server URL</label>
          <p style={styles.description}>
            The WebSocket URL of your Prexu relay server. This server
            coordinates Watch Together sessions between clients.
          </p>
          <div style={styles.inputRow}>
            <input
              type="text"
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
              placeholder="ws://localhost:8080/ws"
              style={styles.input}
            />
            <button onClick={handleSave} style={styles.saveButton}>
              {saved ? "Saved!" : "Save"}
            </button>
          </div>
          <div style={styles.statusRow}>
            <div
              style={{
                ...styles.statusDot,
                background: isRelayConnected ? "#4caf50" : "#ef4444",
              }}
            />
            <span style={styles.statusText}>
              {isRelayConnected
                ? "Connected to relay"
                : "Not connected"}
            </span>
          </div>
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
  inputRow: {
    display: "flex",
    gap: "0.5rem",
  },
  input: {
    flex: 1,
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
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
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginTop: "0.5rem",
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
};

export default Settings;
