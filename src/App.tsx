import { lazy, Suspense, useState, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import AppLayout from "./components/AppLayout";
import PlayerOverlay from "./components/PlayerOverlay";
import PlayBridge from "./components/PlayBridge";
import SplashScreen from "./components/SplashScreen";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { useAuth, useAuthState, AuthProvider } from "./hooks/useAuth";
import AppProviders from "./contexts/AppProviders";
import { getLibrarySections, getRecentlyAddedBySection, getOnDeck } from "./services/plex-library";
import { groupRecentlyAdded } from "./utils/groupRecentlyAdded";
import { cacheSet } from "./services/api-cache";
import { logger } from "./services/logger";

// Lazy-loaded page components
const Login = lazy(() => import("./pages/Login"));
const ServerSelect = lazy(() => import("./pages/ServerSelect"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const LibraryView = lazy(() => import("./pages/LibraryView"));
const ItemDetail = lazy(() => import("./pages/ItemDetail"));
const SearchResults = lazy(() => import("./pages/SearchResults"));
const Settings = lazy(() => import("./pages/Settings"));
const WatchHistory = lazy(() => import("./pages/WatchHistory"));
const CollectionsBrowser = lazy(() => import("./pages/CollectionsBrowser"));
const CollectionDetail = lazy(() => import("./pages/CollectionDetail"));
const PlaylistsBrowser = lazy(() => import("./pages/PlaylistsBrowser"));
const PlaylistDetail = lazy(() => import("./pages/PlaylistDetail"));
const Requests = lazy(() => import("./pages/Requests"));
const ActorDetail = lazy(() => import("./pages/ActorDetail"));
const DiscoverDetail = lazy(() => import("./pages/DiscoverDetail"));
const Downloads = lazy(() => import("./pages/Downloads"));

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <p>Loading...</p>
    </div>
  );
}

/** Route guard for unauthenticated routes */
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/servers" replace />;
  return <>{children}</>;
}

/** Route guard for server selection */
function ServerRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, serverSelected } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (serverSelected) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** sessionStorage key holding the last route the user was on before
 *  entering /play/*. The Player's Exit button reads this to restore the
 *  user's pre-playback context (typically an item-detail page) instead of
 *  walking back through every auto-advanced episode in history. */
export const LAST_NON_PLAYER_ROUTE_KEY = "prexu.lastNonPlayerRoute";

function ServerUnreachableBanner() {
  const { serverUnreachable, changeServer } = useAuth();

  if (!serverUnreachable) return null;

  return (
    <div style={bannerStyles.banner} role="alert" aria-live="assertive">
      <span style={bannerStyles.message}>
        Server unreachable — could not connect to your Plex server.
      </span>
      <button
        style={bannerStyles.button}
        onClick={() => void changeServer()}
      >
        Change Server
      </button>
    </div>
  );
}

const bannerStyles: Record<string, React.CSSProperties> = {
  banner: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    padding: "0.75rem 1.5rem",
    background: "var(--error, #c0392b)",
    color: "#fff",
    fontSize: "0.9rem",
    fontWeight: 500,
  },
  message: {
    flex: 1,
    textAlign: "center" as const,
  },
  button: {
    background: "rgba(255,255,255,0.2)",
    color: "#fff",
    fontWeight: 600,
    padding: "0.4rem 1rem",
    borderRadius: "6px",
    fontSize: "0.85rem",
    border: "1px solid rgba(255,255,255,0.4)",
    flexShrink: 0,
    cursor: "pointer",
  },
};

function AppRoutes() {
  const { isLoading, isAuthenticated, serverSelected, server } = useAuth();
  const { installing: updaterInstalling, downloadProgress: updaterProgress } = useAutoUpdate();
  const [appReady, setAppReady] = useState(false);
  const location = useLocation();

  // Track the most recent non-player route so the Exit button in Player
  // can restore the user's pre-playback context. Auto-advancing through
  // multiple episodes piles /play/* entries onto history, which used to
  // trap the user on Back; persisting a single "where were you before
  // playback" pointer in sessionStorage sidesteps that entirely.
  useEffect(() => {
    if (!location.pathname.startsWith("/play/")) {
      sessionStorage.setItem(
        LAST_NON_PLAYER_ROUTE_KEY,
        location.pathname + location.search,
      );
    }
  }, [location.pathname, location.search]);

  // Wait for auth AND initial data before dismissing the splash screen.
  // When authenticated with a server, prefetch library sections so the
  // sidebar renders instantly instead of showing skeleton placeholders.
  useEffect(() => {
    if (isLoading) return; // auth still resolving

    if (!isAuthenticated || !serverSelected || !server) {
      // No server — show login/server select immediately
      setAppReady(true);
      return;
    }

    // Authenticated with server — prefetch library sections + dashboard data
    // independently. Dismiss the splash as soon as a "quorum" of dashboard
    // sections has settled (≥2 of 3 movies/shows/deck) so a single slow
    // section doesn't strand the user on the splash for 30+ seconds.
    let cancelled = false;
    const QUORUM = 2;
    const HARD_CAP_MS = 20000;
    let settledCount = 0;

    const dismissIfQuorum = () => {
      if (cancelled) return;
      if (settledCount >= QUORUM) {
        // Cancel the hard cap — without this it always fires at 20s and
        // logs a misleading "hard cap reached" warning even when the splash
        // was dismissed at quorum long before (harmless but poisons logs).
        clearTimeout(hardCapTimer);
        setAppReady(true);
      }
    };

    const trackSettled = (label: string) => () => {
      if (cancelled) return;
      settledCount++;
      logger.debug("splash", `section settled: ${label}`, {
        settled: settledCount,
        of: 3,
      });
      dismissIfQuorum();
    };

    // Hard cap: dismiss splash after HARD_CAP_MS no matter what so the user
    // is not stranded on the splash if every fetch hangs.
    const hardCapTimer = setTimeout(() => {
      if (cancelled) return;
      logger.warn("splash", "hard cap reached, dismissing", { capMs: HARD_CAP_MS });
      setAppReady(true);
    }, HARD_CAP_MS);

    getLibrarySections(server.uri, server.accessToken)
      .then((sections) => {
        if (cancelled) return;
        cacheSet(`library-sections:${server.uri}`, sections, 30 * 60 * 1000, true);

        const movieSections = sections.filter((s) => s.type === "movie");
        const tvSections = sections.filter((s) => s.type === "show");
        const uri = server.uri;
        const token = server.accessToken;

        // Independent fetches — each writes its own per-section cache and
        // counts toward the quorum on settle (resolve OR reject).
        getRecentlyAddedBySection(uri, token, movieSections, 30)
          .then((items) => {
            if (cancelled) return;
            const sorted = items.sort((a, b) => b.addedAt - a.addedAt);
            cacheSet(`dashboard:${uri}:movies`, sorted, 60 * 60 * 1000);
          })
          .finally(trackSettled("movies"));

        getRecentlyAddedBySection(uri, token, tvSections, 30)
          .then((items) => {
            if (cancelled) return;
            const grouped = groupRecentlyAdded(
              items.sort((a, b) => b.addedAt - a.addedAt),
            );
            cacheSet(`dashboard:${uri}:shows`, grouped, 60 * 60 * 1000);
          })
          .finally(trackSettled("shows"));

        getOnDeck(uri, token)
          .then((items) => {
            if (cancelled) return;
            cacheSet(`dashboard:${uri}:deck`, items, 60 * 60 * 1000);
          })
          .finally(trackSettled("deck"));
      })
      .catch(() => {
        // Sections failed entirely — dismiss splash, dashboard will retry
        if (!cancelled) setAppReady(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(hardCapTimer);
    };
  }, [isLoading, isAuthenticated, serverSelected, server]);

  return (
    <>
      <SplashScreen ready={appReady} updating={updaterInstalling} updateProgress={updaterProgress} />
      <ServerUnreachableBanner />
      <Suspense fallback={<LoadingScreen />}>
        {isLoading ? null : <Routes>
        {/* Unauthenticated */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          }
        />

        {/* Server selection */}
        <Route
          path="/servers"
          element={
            <ServerRoute>
              <ServerSelect />
            </ServerRoute>
          }
        />

        {/* Authenticated app shell with sidebar */}
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/library/:sectionId" element={<LibraryView />} />
          <Route path="/item/:ratingKey" element={<ItemDetail />} />
          {/* Bridge for legacy /play/:ratingKey URLs (Watch Together
              invite links, external deep-links). Hands off to the
              PlayerContext + replaces history with the prior route. */}
          <Route path="/play/:ratingKey" element={<PlayBridge />} />
          <Route path="/history" element={<WatchHistory />} />
          <Route path="/collections" element={<CollectionsBrowser />} />
          <Route path="/collection/:collectionKey" element={<CollectionDetail />} />
          <Route path="/playlists" element={<PlaylistsBrowser />} />
          <Route path="/playlist/:playlistKey" element={<PlaylistDetail />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/actor/:actorName" element={<ActorDetail />} />
          <Route path="/discover/:mediaType/:tmdbId" element={<DiscoverDetail />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>}
      </Suspense>
      {/* Player overlay sits at top level, outside the route tree. When
          PlayerContext has an active session it renders Player.tsx as a
          full-viewport fixed overlay; the underlying route stays mounted
          underneath. Stop click → context.stop() → instant reveal. */}
      <PlayerOverlay />
    </>
  );
}

function App() {
  const auth = useAuthState();

  // Signal the Tauri shell that React has painted its first frame so it
  // can show the main window. The window is created with `visible: false`
  // in tauri.conf.json; without this handshake the OS frame would appear
  // over a transparent client area before the splash/AppLayout paint.
  // A Rust-side 3 s safety net shows the window unconditionally if this
  // invoke never lands (broken bundle, JS error before mount). (prexu-vs5)
  useEffect(() => {
    invoke("app_ready").catch(() => {
      // Best-effort: failure here just means the safety net handles it.
    });
  }, []);

  return (
    <AuthProvider value={auth}>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </AuthProvider>
  );
}

export default App;
