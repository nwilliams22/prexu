import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import SplashScreen from "./components/SplashScreen";
import { useAuth, useAuthState, AuthProvider } from "./hooks/useAuth";
import { useInviteState, InviteProvider } from "./hooks/useInvites";
import { usePreferencesState, PreferencesProvider } from "./hooks/usePreferences";
import { useHomeUsersState, HomeUsersProvider } from "./hooks/useHomeUsers";

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
const Player = lazy(() => import("./pages/Player"));

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
  const { isLoading } = useAuth();

  return (
    <>
      <SplashScreen ready={!isLoading} />
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
        <Route path="/play/:ratingKey" element={<Player />} />

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
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>}
      </Suspense>
    </>
  );
}

/**
 * Inner app component — runs inside AuthProvider so useAuth() is available
 * for hooks that depend on auth state (home users, invites, preferences).
 */
function AppWithAuth() {
  const auth = useAuth();
  const homeUsersState = useHomeUsersState();
  const inviteState = useInviteState(auth.authToken, auth.server?.uri ?? null);
  const prefsState = usePreferencesState(auth.activeUser?.id ?? null);

  return (
    <HomeUsersProvider value={homeUsersState}>
      <PreferencesProvider value={prefsState}>
        <InviteProvider value={inviteState}>
          <AppRoutes />
        </InviteProvider>
      </PreferencesProvider>
    </HomeUsersProvider>
  );
}

function App() {
  const auth = useAuthState();

  return (
    <AuthProvider value={auth}>
      <AppWithAuth />
    </AuthProvider>
  );
}

export default App;
