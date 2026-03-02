import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  getPlaylistItems,
  getPlaylists,
  getImageUrl,
  markAsWatched,
  markAsUnwatched,
} from "../services/plex-library";
import LibraryGrid from "../components/LibraryGrid";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import ContextMenu from "../components/ContextMenu";
import type { ContextMenuItem } from "../components/ContextMenu";
import SessionCreator from "../components/SessionCreator";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import type { PlexMediaItem, PlexEpisode, PlexPlaylist } from "../types/library";

interface ContextMenuState {
  position: { x: number; y: number };
  item: PlexMediaItem;
}

interface SessionCreatorState {
  ratingKey: string;
  title: string;
  mediaType: "movie" | "episode";
}

function PlaylistDetail() {
  const { playlistKey } = useParams<{ playlistKey: string }>();
  const { server } = useAuth();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState<PlexPlaylist | null>(null);
  const [items, setItems] = useState<PlexMediaItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sessionCreator, setSessionCreator] =
    useState<SessionCreatorState | null>(null);

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

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  const getTitle = (item: PlexMediaItem): string => {
    if (item.type === "episode") {
      const ep = item as PlexEpisode;
      return ep.grandparentTitle || item.title;
    }
    return item.title;
  };

  const getSubtitle = (item: PlexMediaItem): string => {
    if (item.type === "episode") {
      const ep = item as PlexEpisode;
      return `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")} · ${ep.title}`;
    }
    const withYear = item as { year?: number };
    if (withYear.year) return String(withYear.year);
    return "";
  };

  const getPoster = (item: PlexMediaItem): string => {
    if (item.type === "episode") {
      const ep = item as PlexEpisode;
      return ep.grandparentThumb || item.thumb;
    }
    return item.thumb;
  };

  const getProgress = (item: PlexMediaItem): number | undefined => {
    const withOffset = item as { viewOffset?: number; duration?: number };
    if (withOffset.viewOffset && withOffset.duration) {
      return withOffset.viewOffset / withOffset.duration;
    }
    return undefined;
  };

  const openContextMenu = useCallback(
    (e: React.MouseEvent, item: PlexMediaItem) => {
      setContextMenu({ position: { x: e.clientX, y: e.clientY }, item });
    },
    []
  );

  const buildMenuItems = useCallback(
    (item: PlexMediaItem): ContextMenuItem[] => {
      if (!server) return [];
      const menuItems: ContextMenuItem[] = [];
      const hasView = (item as { viewCount?: number }).viewCount;

      if (hasView) {
        menuItems.push({
          label: "Mark as Unwatched",
          onClick: async () => {
            await markAsUnwatched(server.uri, server.accessToken, item.ratingKey);
          },
        });
      } else {
        menuItems.push({
          label: "Mark as Watched",
          onClick: async () => {
            await markAsWatched(server.uri, server.accessToken, item.ratingKey);
          },
        });
      }

      if (item.type === "movie" || item.type === "episode") {
        menuItems.push({
          label: "Watch Together...",
          dividerAbove: true,
          onClick: () => {
            setSessionCreator({
              ratingKey: item.ratingKey,
              title: item.type === "episode"
                ? `${(item as PlexEpisode).grandparentTitle} - ${item.title}`
                : item.title,
              mediaType: item.type as "movie" | "episode",
            });
          },
        });
      }

      menuItems.push({
        label: "Get Info",
        dividerAbove: item.type !== "movie" && item.type !== "episode",
        onClick: () => navigate(`/item/${item.ratingKey}`),
      });

      return menuItems;
    },
    [server, navigate]
  );

  return (
    <div style={styles.container}>
      {/* Back button */}
      <button onClick={() => navigate("/playlists")} style={styles.backButton}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Playlists
      </button>

      <h2 style={styles.title}>{playlist?.title || "Playlist"}</h2>

      {playlist?.summary && (
        <p style={styles.summary}>{playlist.summary}</p>
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
            imageUrl={posterUrl(getPoster(item))}
            title={getTitle(item)}
            subtitle={getSubtitle(item)}
            progress={getProgress(item)}
            onClick={() => navigate(`/item/${item.ratingKey}`)}
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

      {contextMenu && (
        <ContextMenu
          items={buildMenuItems(contextMenu.item)}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}

      {sessionCreator && (
        <SessionCreator
          ratingKey={sessionCreator.ratingKey}
          title={sessionCreator.title}
          mediaType={sessionCreator.mediaType}
          onClose={() => setSessionCreator(null)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
  },
  backButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    padding: "0.25rem 0",
    marginBottom: "0.75rem",
    cursor: "pointer",
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
