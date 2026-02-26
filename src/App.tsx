import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import ServerSelect from "./pages/ServerSelect";
import Home from "./pages/Home";
import { useAuth, useAuthState, AuthProvider } from "./hooks/useAuth";

function AppRoutes() {
  const { isAuthenticated, isLoading, serverSelected } = useAuth();

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
      <Route
        path="/login"
        element={
          isAuthenticated ? <Navigate to="/servers" replace /> : <Login />
        }
      />
      <Route
        path="/servers"
        element={
          !isAuthenticated ? (
            <Navigate to="/login" replace />
          ) : serverSelected ? (
            <Navigate to="/" replace />
          ) : (
            <ServerSelect />
          )
        }
      />
      <Route
        path="/"
        element={
          !isAuthenticated ? (
            <Navigate to="/login" replace />
          ) : !serverSelected ? (
            <Navigate to="/servers" replace />
          ) : (
            <Home />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  const auth = useAuthState();

  return (
    <AuthProvider value={auth}>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
