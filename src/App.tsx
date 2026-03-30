import { lazy, Suspense, useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import SplashScreen from "./components/SplashScreen";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { useAuth, useAuthState, AuthProvider } from "./hooks/useAuth";
import AppProviders from "./contexts/AppProviders";
import ErrorBoundary from "./components/ErrorBoundary";
import { getLibrarySections, getRecentlyAddedBySection, getOnDeck } from "./services/plex-library";
import { groupRecentlyAdded } from "./utils/groupRecentlyAdded";
import { cacheSet } from "./services/api-cache";

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
const Player = lazy(() => import("./pages/Player"));
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

function AppRoutes() {
  const { isLoading, isAuthenticated, serverSelected, server } = useAuth();
  const { installing: updaterInstalling, downloadProgress: updaterProgress } = useAutoUpdate();
  const [appReady, setAppReady] = useState(false);

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

    // Authenticated with server — prefetch library sections + dashboard data,
    // then dismiss splash. This ensures the dashboard renders fully on first paint.
    getLibrarySections(server.uri, server.accessToken)
      .then(async (sections) => {
        // Cache sections for useLibrary
        cacheSet(`library-sections:${server.uri}`, sections, 30 * 60 * 1000, true);

        // Prefetch dashboard data so it's cached when useDashboard mounts
        try {
          const movieSections = sections.filter((s) => s.type === "movie");
          const tvSections = sections.filter((s) => s.type === "show");
          const [movieItems, tvItems, deckItems] = await Promise.all([
            getRecentlyAddedBySection(server.uri, server.accessToken, movieSections, 30),
            getRecentlyAddedBySection(server.uri, server.accessToken, tvSections, 30),
            getOnDeck(server.uri, server.accessToken),
          ]);

          const movies = movieItems.sort((a, b) => b.addedAt - a.addedAt);
          const shows = groupRecentlyAdded(tvItems.sort((a, b) => b.addedAt - a.addedAt));
          const dashKey = `dashboard:${server.uri}`;
          cacheSet(dashKey, { recentMovies: movies, recentShows: shows, onDeck: deckItems }, 60 * 60 * 1000);
        } catch {
          // Non-critical — dashboard will fetch on mount
        }

        setAppReady(true);
      })
      .catch(() => {
        // Show app even on error — sidebar will retry
        setAppReady(true);
      });
  }, [isLoading, isAuthenticated, serverSelected, server]);

  return (
    <>
      <SplashScreen ready={appReady} updating={updaterInstalling} updateProgress={updaterProgress} />
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

        {/* Player route — no sidebar/header */}
        <Route path="/play/:ratingKey" element={<ErrorBoundary><Player /></ErrorBoundary>} />

        {/* Authenticated app shell with sidebar */}
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/library/:sectionId" element={<LibraryView />} />
          <Route path="/item/:ratingKey" element={<ItemDetail />} />
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
    </>
  );
}

function App() {
  const auth = useAuthState();

  return (
    <AuthProvider value={auth}>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </AuthProvider>
  );
}

export default App;
