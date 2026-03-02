import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import ServerSelect from "./pages/ServerSelect";
import Dashboard from "./pages/Dashboard";
import LibraryView from "./pages/LibraryView";
import ItemDetail from "./pages/ItemDetail";
import SearchResults from "./pages/SearchResults";
import Settings from "./pages/Settings";
import WatchHistory from "./pages/WatchHistory";
import CollectionsBrowser from "./pages/CollectionsBrowser";
import CollectionDetail from "./pages/CollectionDetail";
import PlaylistsBrowser from "./pages/PlaylistsBrowser";
import PlaylistDetail from "./pages/PlaylistDetail";
import Player from "./pages/Player";
import AppLayout from "./components/AppLayout";
import { useAuth, useAuthState, AuthProvider } from "./hooks/useAuth";
import { useInviteState, InviteProvider } from "./hooks/useInvites";
import { usePreferencesState, PreferencesProvider } from "./hooks/usePreferences";
import { useHomeUsersState, HomeUsersProvider } from "./hooks/useHomeUsers";

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

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading Prexu...</p>
      </div>
    );
  }

  return (
    <Routes>
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
    </Routes>
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
