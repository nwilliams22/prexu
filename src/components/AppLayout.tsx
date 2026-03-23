import { useState, useRef, useEffect, useCallback } from "react";
import { Outlet, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePreferences } from "../hooks/usePreferences";
import { useThemeEffect } from "../hooks/useTheme";
import { useBreakpoint, isMobile, isTabletOrBelow, isDesktopOrAbove } from "../hooks/useBreakpoint";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useRouteAnnouncer } from "../hooks/useRouteAnnouncer";
import { useNewContent } from "../hooks/useNewContent";
import type { UseNewContentResult } from "../hooks/useNewContent";
import Sidebar from "./Sidebar";
import NavButtons from "./NavButtons";
import SearchBar from "./SearchBar";
import UserSwitcher from "./UserSwitcher";
import RequestBell from "./RequestBell";
import ActivityButton from "./ActivityButton";
import InviteNotification from "./InviteNotification";
import ErrorBoundary from "./ErrorBoundary";
import BottomNav from "./BottomNav";

export type { UseNewContentResult };

function AppLayout() {
  const { isAuthenticated, serverSelected } = useAuth();
  const { preferences } = usePreferences();
  useThemeEffect(preferences.appearance.theme);
  const bp = useBreakpoint();
  const navigate = useNavigate();
  const newContent = useNewContent();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => preferences.appearance.sidebarCollapsed
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarOverlayRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    el.classList.add("scrolling");
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      el.classList.remove("scrolling");
    }, 1200);
  }, []);

  const mobile = isMobile(bp);
  const tabletOrBelow = isTabletOrBelow(bp);
  const desktopOrAbove = isDesktopOrAbove(bp);

  useFocusTrap(sidebarOverlayRef, sidebarOpen && tabletOrBelow);
  useRouteAnnouncer();

  // Close sidebar overlay on Escape
  useEffect(() => {
    if (!sidebarOpen || !tabletOrBelow) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [sidebarOpen, tabletOrBelow]);

  // Auth guards
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!serverSelected) return <Navigate to="/servers" replace />;

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        {/* Left: logo/hamburger area — matches sidebar width below */}
        {tabletOrBelow ? (
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            style={styles.hamburgerButton}
            aria-label="Toggle menu"
          >
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <line x1={3} y1={6} x2={21} y2={6} />
              <line x1={3} y1={12} x2={21} y2={12} />
              <line x1={3} y1={18} x2={21} y2={18} />
            </svg>
          </button>
        ) : (
          <div style={{
            ...styles.logoArea,
            width: sidebarCollapsed ? 60 : 220,
          }}>
            <button
              onClick={() => navigate("/")}
              style={styles.logoButton}
            >
              Prexu
            </button>
          </div>
        )}

        {/* Back/Forward — aligned above main content start */}
        <NavButtons />

        <div style={styles.headerCenter}>
          <SearchBar />
        </div>

        <div style={styles.headerRight}>
          <ActivityButton />
          <RequestBell />
          <UserSwitcher />
        </div>
      </header>

      {/* Body: Sidebar + Main Content */}
      <div style={styles.body}>
        {/* Desktop: inline sidebar */}
        {desktopOrAbove && (
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((c) => !c)}
            newSections={newContent.newSections}
            onMarkSectionSeen={newContent.markSectionSeen}
          />
        )}

        {/* Tablet/Mobile: overlay sidebar */}
        {tabletOrBelow && sidebarOpen && (
          <>
            <div
              aria-hidden="true"
              style={styles.sidebarBackdrop}
              onClick={() => setSidebarOpen(false)}
            />
            <div
              ref={sidebarOverlayRef}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              style={styles.sidebarOverlay}
            >
              <Sidebar
                collapsed={false}
                onToggle={() => setSidebarOpen(false)}
                onNavigate={() => setSidebarOpen(false)}
                newSections={newContent.newSections}
                onMarkSectionSeen={newContent.markSectionSeen}
              />
            </div>
          </>
        )}

        <main
          ref={mainRef}
          className="auto-hide-scrollbar"
          onScroll={handleScroll}
          style={{
            ...styles.main,
            ...(mobile ? { paddingBottom: "56px" } : {}),
          }}
        >
          <InviteNotification />
          <div style={styles.pageTransition}>
            <ErrorBoundary>
              <Outlet context={newContent} />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* Mobile: bottom navigation */}
      {mobile && <BottomNav />}
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
  logoArea: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    transition: "width 0.2s ease",
  },
  logoButton: {
    background: "transparent",
    color: "var(--accent)",
    fontSize: "1.25rem",
    fontWeight: 700,
    padding: 0,
  },
  hamburgerButton: {
    background: "transparent",
    color: "var(--text-primary)",
    padding: "0.25rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headerCenter: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    minWidth: 0,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flexShrink: 0,
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
  sidebarBackdrop: {
    position: "fixed",
    top: "52px",
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.5)",
    zIndex: 999,
  },
  sidebarOverlay: {
    position: "fixed",
    top: "52px",
    left: 0,
    bottom: 0,
    width: "220px",
    zIndex: 1000,
    animation: "slideRight 0.2s ease-out",
  },
};

export default AppLayout;
