import { useState } from "react";
import { Outlet, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePreferences } from "../hooks/usePreferences";
import Sidebar from "./Sidebar";
import SearchBar from "./SearchBar";
import UserSwitcher from "./UserSwitcher";
import InviteNotification from "./InviteNotification";
import ErrorBoundary from "./ErrorBoundary";

function AppLayout() {
  const { isAuthenticated, serverSelected } = useAuth();
  const { preferences } = usePreferences();
  const navigate = useNavigate();
  const location = useLocation();
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
          <UserSwitcher />
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
          <div key={location.pathname} style={styles.pageTransition}>
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
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
  body: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  main: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  pageTransition: {
    animation: "pageEnter 0.2s ease-out",
    flex: 1,
  },
};

export default AppLayout;
