import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  getPlaylistItems,
  getPlaylists,
  getImageUrl,
} from "../services/plex-library";
import { useMediaContextMenu } from "../hooks/useMediaContextMenu";
import { usePlayAction } from "../hooks/usePlayAction";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import LibraryGrid from "../components/LibraryGrid";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import { decodeHtmlEntities } from "../utils/media-helpers";
import {
  getMediaTitle,
  getMediaSubtitle,
  getMediaPoster,
  getProgress,
} from "../utils/media-helpers";
import type { PlexMediaItem, PlexPlaylist } from "../types/library";

function PlaylistDetail() {
  const { playlistKey } = useParams<{ playlistKey: string }>();
  const { server } = useAuth();
  const navigate = useNavigate();
  useScrollRestoration();
  const { openContextMenu, overlays: menuOverlays } = useMediaContextMenu();
  const { getPlayHandler, playOverlay } = usePlayAction();
  const [playlist, setPlaylist] = useState<PlexPlaylist | null>(null);
  const [items, setItems] = useState<PlexMediaItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server || !playlistKey) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch playlist items
        const result = await getPlaylistItems(
          server.uri,
          server.accessToken,
          playlistKey
        );
        if (!cancelled) {
          setItems(result.items);
          setTotalSize(result.totalSize);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load playlist"
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, playlistKey]);

  // Fetch playlist metadata separately for title/summary
  useEffect(() => {
    if (!server || !playlistKey) return;
    let cancelled = false;

    (async () => {
      try {
        const all = await getPlaylists(server.uri, server.accessToken);
        if (!cancelled) {
          const match = all.find((p) => p.ratingKey === playlistKey);
          if (match) setPlaylist(match);
        }
      } catch {
        // Non-critical — title falls back to "Playlist"
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, playlistKey]);

  useEffect(() => {
    if (playlist) document.title = `${playlist.title} - Prexu`;
  }, [playlist]);

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>{playlist?.title || "Playlist"}</h2>

      {playlist?.summary && (
        <p style={styles.summary}>{decodeHtmlEntities(playlist.summary)}</p>
      )}

      {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}

      {!isLoading && !error && totalSize > 0 && (
        <p style={styles.count}>
          {totalSize.toLocaleString()} item{totalSize !== 1 ? "s" : ""}
        </p>
      )}

      <LibraryGrid>
        {isLoading &&
          Array.from({ length: 24 }).map((_, i) => <SkeletonCard key={i} />)}

        {items.map((item, index) => (
          <PosterCard
            key={`${item.ratingKey}-${index}`}
            ratingKey={item.ratingKey}
            imageUrl={posterUrl(getMediaPoster(item))}
            title={getMediaTitle(item)}
            subtitle={getMediaSubtitle(item)}
            progress={getProgress(item)}
            onClick={() => navigate(`/item/${item.ratingKey}`)}
            onPlay={getPlayHandler(item)}
            showMoreButton
            onContextMenu={(e) => openContextMenu(e, item)}
            onMoreClick={(e) => openContextMenu(e, item)}
          />
        ))}
      </LibraryGrid>

      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <line x1={8} y1={6} x2={21} y2={6} />
              <line x1={8} y1={12} x2={21} y2={12} />
              <line x1={8} y1={18} x2={21} y2={18} />
              <line x1={3} y1={6} x2={3.01} y2={6} />
              <line x1={3} y1={12} x2={3.01} y2={12} />
              <line x1={3} y1={18} x2={3.01} y2={18} />
            </svg>
          }
          title="Empty playlist"
          subtitle="This playlist doesn't have any items yet."
          action={{ label: "Back to Playlists", onClick: () => navigate("/playlists") }}
        />
      )}

      {menuOverlays}
      {playOverlay}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 600,
    marginBottom: "0.5rem",
  },
  summary: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    maxWidth: "600px",
    marginBottom: "1rem",
  },
  count: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    marginBottom: "1rem",
  },
};

export default PlaylistDetail;
