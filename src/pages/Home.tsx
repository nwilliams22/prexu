import { useAuth } from "../hooks/useAuth";

function Home() {
  const { server, logout, changeServer } = useAuth();

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.logo}>Prexu</h1>
        <div style={styles.headerRight}>
          <span style={styles.serverName}>
            {server?.name ?? "No server"}
          </span>
          <button onClick={changeServer} style={styles.headerButton}>
            Change Server
          </button>
          <button onClick={logout} style={styles.headerButton}>
            Sign Out
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.placeholder}>
          <h2 style={styles.placeholderTitle}>Welcome to Prexu</h2>
          <p style={styles.placeholderText}>
            Connected to <strong>{server?.name}</strong>
          </p>
          <p style={styles.placeholderHint}>
            Library browsing coming in Phase 2.
          </p>
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.75rem 1.5rem",
    background: "var(--bg-secondary)",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  logo: {
    fontSize: "1.25rem",
    fontWeight: 700,
    color: "var(--accent)",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
  },
  serverName: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  headerButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.8rem",
    padding: "0.35rem 0.75rem",
    borderRadius: "4px",
    border: "1px solid var(--border)",
  },
  main: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
  },
  placeholder: {
    textAlign: "center" as const,
  },
  placeholderTitle: {
    fontSize: "1.5rem",
    fontWeight: 600,
    marginBottom: "0.75rem",
  },
  placeholderText: {
    fontSize: "1rem",
    color: "var(--text-secondary)",
    marginBottom: "0.5rem",
  },
  placeholderHint: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    opacity: 0.6,
  },
};

export default Home;
