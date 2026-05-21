import { useState, useRef, useEffect, useCallback } from "react";
import { Outlet, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePlayerSession } from "../contexts/PlayerContext";
import { usePreferences } from "../hooks/usePreferences";
import { useThemeEffect } from "../hooks/useTheme";
import { useWatchSync } from "../hooks/useWatchSync";
import { useBreakpoint, isMobile, isTabletOrBelow, isDesktopOrAbove } from "../hooks/useBreakpoint";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useRouteAnnouncer } from "../hooks/useRouteAnnouncer";
import { useNewContent } from "../hooks/useNewContent";
import Sidebar from "./Sidebar";
import NavButtons from "./NavButtons";
import SearchBar from "./SearchBar";
import UserSwitcher from "./UserSwitcher";
import RequestBell from "./RequestBell";
import ActivityButton from "./ActivityButton";
import InviteNotification from "./InviteNotification";
import ErrorBoundary from "./ErrorBoundary";
import BottomNav from "./BottomNav";

function AppLayout() {
  const auth = useAuth();
  const { isAuthenticated, serverSelected } = auth;
  const playerSession = usePlayerSession();
  const { preferences } = usePreferences();
  useThemeEffect(preferences.appearance.theme);
  useWatchSync(auth.server ?? null);
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

  // Route-transition spinner — covers the gap between AppLayout/route mount
  // and the destination page's first paint. Most visible when navigating
  // FROM the player route, because AppLayout itself is freshly mounting
  // (Player is rendered outside AppLayout). Without this overlay the user
  // sees ~1s of static navy bg before the destination page renders content,
  // which feels broken (prexu-zq4). The 600ms ceiling is empirical: covers
  // the dev-mode gap observed in user testing while staying short enough
  // that snappy transitions don't visibly linger.
  const location = useLocation();
  const lastPathRef = useRef(location.pathname);
  const [showTransitionSpinner, setShowTransitionSpinner] = useState(true);
  useEffect(() => {
    // Either the AppLayout just mounted (initial true) or pathname changed
    // — either way, hide after the gap window closes.
    if (location.pathname !== lastPathRef.current) {
      lastPathRef.current = location.pathname;
      setShowTransitionSpinner(true);
    }
    const id = window.setTimeout(() => setShowTransitionSpinner(false), 600);
    return () => window.clearTimeout(id);
  }, [location.pathname]);

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

  // prexu-quq: keep the AppLayout mask STATIC across full-player ↔
  // minimize. The corner hole is applied whenever a player session is
  // active — full-player or minimize. Switching between modes only
  // changes OPACITY (0 in full-player, 1 in minimize). This avoids the
  // ~1s Dashboard repaint we were hitting when the mask shape changed:
  // mask-size/mask-position transitions invalidate the compositor
  // cache, forcing the browser to re-paint every child of AppLayout.
  //
  // Opacity is a pure GPU compositor toggle on a persistent layer.
  // To make sure the browser doesn't optimize away the painted layer
  // while opacity is 0, we add `will-change: opacity` AND
  // `transform: translateZ(0)` whenever a session exists — these two
  // together force a persistent GPU layer that survives opacity:0
  // without being purged.
  //
  // Why the corner hole in full-player mode? It's invisible anyway
  // (whole element at opacity:0), so the hole shape doesn't matter
  // visually. Keeping the SAME mask means zero compositor invalidation
  // on transition. The hole only "matters" when opacity flips back
  // to 1 in minimize mode.
  //
  // pointerEvents:none in full-player so clicks pass through to
  // PlayerOverlay below.
  //
  // History of this hiding mechanism on this branch:
  //   prexu-kfa  → introduced visibility:hidden (replaced display:none
  //                which broke VirtualizedLibraryGrid's clientWidth)
  //   prexu-ya6  → gated on !isMinimized so app shows in 7il.3
  //   prexu-cay  → switched to opacity:0 to keep paint warm
  //   prexu-9bk  → switched to mask-based hiding because opacity:0
  //                still allowed paint-skip on Dashboard
  //   prexu-quq  → realized the mask CHANGE was the cost; keep mask
  //                static + use opacity + will-change for the toggle
  //
  // prexu-s0f, prexu-4ml: corner hole is sized + positioned to match
  // miniContainer in Player.tsx exactly. Four-value mask-position
  // syntax (`right 16px bottom 16px`) — NOT calc(100% - 376px) which
  // percentage-rule-resolves wrong. When 7il.5's resizable-minimize
  // lands, the corner-hole values will need to bind to PlayerContext
  // state instead of hardcoded.
  const isFullPlayer =
    playerSession.session != null && !playerSession.isMinimized;
  const hasSession = playerSession.session != null;

  const maskStyle: React.CSSProperties = hasSession
    ? {
        WebkitMaskImage:
          "linear-gradient(#000, #000), linear-gradient(#000, #000)",
        maskImage:
          "linear-gradient(#000, #000), linear-gradient(#000, #000)",
        WebkitMaskSize: "100% 100%, 360px 200px",
        maskSize: "100% 100%, 360px 200px",
        WebkitMaskPosition: "0 0, right 16px bottom 16px",
        maskPosition: "0 0, right 16px bottom 16px",
        WebkitMaskRepeat: "no-repeat, no-repeat",
        maskRepeat: "no-repeat, no-repeat",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
      }
    : {};

  const layerStyle: React.CSSProperties = hasSession
    ? {
        willChange: "opacity",
        transform: "translateZ(0)",
      }
    : {};

  return (
    <div
      style={{
        ...styles.container,
        opacity: isFullPlayer ? 0 : 1,
        pointerEvents: isFullPlayer ? "none" : "auto",
        ...layerStyle,
        ...maskStyle,
      }}
    >
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
              <Outlet />
            </ErrorBoundary>
          </div>
          {showTransitionSpinner && (
            <div style={styles.transitionSpinner} aria-hidden>
              <div className="loading-spinner" />
            </div>
          )}
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
    // Owns the background for the route content area so the post-Player-
    // unmount transition doesn't show body navy through a transparent
    // Outlet (prexu-zq4). Same colour as body bg, so no visual change in
    // steady state — but it lets us decouple Player.tsx's body-bg dance
    // from what the user sees during route transitions.
    background: "var(--bg-primary)",
    // Required for the absolutely-positioned transition spinner overlay.
    position: "relative",
  },
  transitionSpinner: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-primary)",
    zIndex: 5,
    pointerEvents: "none",
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
