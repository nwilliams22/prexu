import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { discoverServers } from "../services/plex-api";
import type { PlexServer } from "../types/plex";

function ServerSelect() {
  const { authToken, selectServer, logout } = useAuth();
  const [servers, setServers] = useState<PlexServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authToken) return;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const discovered = await discoverServers(authToken);
        setServers(discovered);

        // Auto-select if there's exactly one online server
        const onlineServers = discovered.filter((s) => s.status === "online");
        if (onlineServers.length === 1) {
          const server = onlineServers[0];
          await selectServer({
            name: server.name,
            clientIdentifier: server.clientIdentifier,
            accessToken: server.accessToken,
            uri: server.uri,
          });
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to discover servers."
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [authToken, selectServer]);

  const handleSelect = async (server: PlexServer) => {
    if (server.status !== "online") return;
    await selectServer({
      name: server.name,
      clientIdentifier: server.clientIdentifier,
      accessToken: server.accessToken,
      uri: server.uri,
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Select a Server</h1>
        <p style={styles.subtitle}>
          Choose which Plex server you'd like to connect to.
        </p>

        {loading && (
          <div style={styles.loadingContainer}>
            <div style={styles.spinner} />
            <p style={styles.loadingText}>Discovering servers...</p>
          </div>
        )}

        {error && (
          <div style={styles.errorContainer}>
            <p style={styles.errorText}>{error}</p>
            <button
              onClick={() => window.location.reload()}
              style={styles.retryButton}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && servers.length === 0 && (
          <div style={styles.emptyContainer}>
            <p style={styles.emptyText}>
              No Plex servers found on your account.
            </p>
          </div>
        )}

        {!loading && !error && servers.length > 0 && (
          <div style={styles.serverList}>
            {servers.map((server) => (
              <button
                key={server.clientIdentifier}
                onClick={() => handleSelect(server)}
                style={{
                  ...styles.serverItem,
                  opacity: server.status === "online" ? 1 : 0.5,
                  cursor:
                    server.status === "online" ? "pointer" : "not-allowed",
                }}
              >
                <div style={styles.serverInfo}>
                  <span style={styles.serverName}>{server.name}</span>
                  <span style={styles.serverMeta}>
                    {server.owned ? "Owned" : "Shared"}
                    {server.local ? " · Local" : " · Remote"}
                  </span>
                </div>
                <span
                  style={{
                    ...styles.statusDot,
                    backgroundColor:
                      server.status === "online"
                        ? "var(--success)"
                        : "var(--error)",
                  }}
                />
              </button>
            ))}
          </div>
        )}

        <button onClick={logout} style={styles.logoutButton}>
          Sign out
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    padding: "2rem",
  },
  card: {
    background: "var(--bg-card)",
    borderRadius: "12px",
    padding: "2.5rem",
    maxWidth: "500px",
    width: "100%",
    border: "1px solid var(--border)",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 600,
    marginBottom: "0.5rem",
  },
  subtitle: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    marginBottom: "1.5rem",
  },
  loadingContainer: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "1rem",
    padding: "2rem 0",
  },
  spinner: {
    width: "36px",
    height: "36px",
    border: "3px solid var(--border)",
    borderTopColor: "var(--accent)",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  loadingText: {
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
  },
  errorContainer: {
    textAlign: "center" as const,
    padding: "1.5rem 0",
  },
  errorText: {
    color: "var(--error)",
    marginBottom: "1rem",
    fontSize: "0.9rem",
  },
  retryButton: {
    background: "var(--accent)",
    color: "#000",
    fontWeight: 600,
    padding: "0.5rem 1.5rem",
    borderRadius: "6px",
    fontSize: "0.9rem",
  },
  emptyContainer: {
    textAlign: "center" as const,
    padding: "2rem 0",
  },
  emptyText: {
    color: "var(--text-secondary)",
  },
  serverList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.5rem",
    marginBottom: "1.5rem",
  },
  serverItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "1rem 1.25rem",
    width: "100%",
    textAlign: "left" as const,
    transition: "border-color 0.2s",
    color: "var(--text-primary)",
  },
  serverInfo: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.25rem",
  },
  serverName: {
    fontSize: "1rem",
    fontWeight: 500,
  },
  serverMeta: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
  },
  statusDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  logoutButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    padding: "0.5rem 1rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    width: "100%",
    marginTop: "0.5rem",
  },
};

export default ServerSelect;
