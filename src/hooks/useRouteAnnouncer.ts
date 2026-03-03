import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAnnounce } from "./useAnnounce";

const ROUTE_TITLES: Record<string, string> = {
  "/": "Home",
  "/history": "Watch History",
  "/collections": "Collections",
  "/playlists": "Playlists",
  "/search": "Search Results",
  "/settings": "Settings",
  "/login": "Sign In",
  "/servers": "Select Server",
};

function getPageTitle(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  if (pathname.startsWith("/library/")) return "Library";
  if (pathname.startsWith("/item/")) return "Details";
  if (pathname.startsWith("/collection/")) return "Collection";
  if (pathname.startsWith("/playlist/")) return "Playlist";
  if (pathname.startsWith("/play/")) return "Player";
  return "Prexu";
}

export function useRouteAnnouncer() {
  const location = useLocation();
  const announce = useAnnounce();

  useEffect(() => {
    const title = getPageTitle(location.pathname);
    document.title = `${title} - Prexu`;
    announce(`Navigated to ${title}`);
  }, [location.pathname, announce]);
}
