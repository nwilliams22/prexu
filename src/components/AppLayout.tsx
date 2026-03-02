import { useState } from "react";
import { Outlet, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePreferences } from "../hooks/usePreferences";
import Sidebar from "./Sidebar";
import SearchBar from "./SearchBar";
import InviteNotification from "./InviteNotification";
import ErrorBoundary from "./ErrorBoundary";

function AppLayout() {
  const { isAuthenticated, serverSelected, server, logout, changeServer } =
    useAuth();
  const { preferences } = usePreferences();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => preferences.appearance.sidebarCollapsed
  );

  // Auth guards
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!serverSelected) return <Navigate to="/servers" replace />;

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <button
          onClick={() => navigate("/")}
          style={styles.logoButton}
        >
          Prexu
        </button>

        <SearchBar />

        <div style={styles.headerRight}>
          <span style={styles.serverName}>{server?.name}</span>
          <button
            onClick={() => navigate("/settings")}
            style={styles.headerButton}
          >
            Settings
          </button>
          <button onClick={changeServer} style={styles.headerButton}>
            Change Server
          </button>
          <button onClick={logout} style={styles.headerButton}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Body: Sidebar + Main Content */}
      <div style={styles.body}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
        />
        <main style={styles.main}>
          <InviteNotification />
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 1.25rem",
    height: "52px",
    background: "var(--bg-secondary)",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  logoButton: {
    background: "transparent",
    color: "var(--accent)",
    fontSize: "1.25rem",
    fontWeight: 700,
    padding: 0,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
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
  body: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  main: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
  },
};

export default AppLayout;
