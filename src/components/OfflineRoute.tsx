import { useEffect, useRef } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/** Keep local downloads and settings available while library requests cannot work. */
export default function OfflineRoute({ children }: { children: React.ReactNode }) {
  const { serverUnreachable } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const wasOffline = useRef(serverUnreachable);

  useEffect(() => {
    if (wasOffline.current && !serverUnreachable && pathname === "/downloads") {
      navigate("/", { replace: true });
    }
    wasOffline.current = serverUnreachable;
  }, [serverUnreachable, pathname, navigate]);

  if (serverUnreachable && pathname !== "/downloads" &&
      pathname !== "/settings" && !pathname.startsWith("/settings/")) {
    return <Navigate to="/downloads" replace />;
  }
  return <>{children}</>;
}

export function OfflineBanner() {
  const { serverUnreachable, changeServer } = useAuth();
  if (!serverUnreachable) return null;
  return (
    <div role="status" style={{ padding: "0.75rem 1.25rem", background: "var(--bg-secondary)", flexShrink: 0 }}>
      Offline — your Plex server is unavailable. You can play your downloads.
      {" "}<button onClick={() => void changeServer()}>Change Server</button>
    </div>
  );
}
