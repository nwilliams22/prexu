import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  getItemMetadata,
  getCollectionItems,
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
import PlaylistPicker from "../components/PlaylistPicker";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import type { PlexMediaItem, PlexEpisode, PlexShow } from "../types/library";

interface ContextMenuState {
  position: { x: number; y: number };
  item: PlexMediaItem;
}

interface SessionCreatorState {
  ratingKey: string;
  title: string;
  mediaType: "movie" | "episode";
}

interface PlaylistPickerState {
  ratingKey: string;
  title: string;
}

function CollectionDetail() {
  const { collectionKey } = useParams<{ collectionKey: string }>();
  const { server } = useAuth();
  const navigate = useNavigate();
  const [collectionTitle, setCollectionTitle] = useState("");
  const [collectionSummary, setCollectionSummary] = useState("");
  const [items, setItems] = useState<PlexMediaItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sessionCreator, setSessionCreator] =
    useState<SessionCreatorState | null>(null);
  const [playlistPicker, setPlaylistPicker] =
    useState<PlaylistPickerState | null>(null);

  useEffect(() => {
    if (!server || !collectionKey) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch collection metadata for title/summary
        const meta = await getItemMetadata<PlexMediaItem>(
          server.uri,
          server.accessToken,
          collectionKey
        );
        if (!cancelled) {
          setCollectionTitle(meta.title);
          setCollectionSummary(meta.summary || "");
        }

        // Fetch collection items
        const result = await getCollectionItems(
          server.uri,
          server.accessToken,
          collectionKey
        );
        if (!cancelled) {
          setItems(result.items);
          setTotalSize(result.totalSize);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load collection"
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, collectionKey]);

  useEffect(() => {
    if (collectionTitle) document.title = `${collectionTitle} - Prexu`;
  }, [collectionTitle]);

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  const getSubtitle = (item: PlexMediaItem): string => {
    if (item.type === "show") {
      const show = item as PlexShow;
      const parts: string[] = [];
      if (show.year) parts.push(String(show.year));
      if (show.leafCount) parts.push(`${show.leafCount} eps`);
      return parts.join(" · ");
    }
    const withYear = item as { year?: number };
    if (withYear.year) return String(withYear.year);
    return "";
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

      if (item.type === "movie" || item.type === "episode") {
        menuItems.push({
          label: "Add to Playlist...",
          onClick: () =>
            setPlaylistPicker({
              ratingKey: item.ratingKey,
              title: item.title,
            }),
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
      <h2 style={styles.title}>{collectionTitle || "Collection"}</h2>

      {collectionSummary && !isLoading && (
        <p style={styles.summary}>{collectionSummary}</p>
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

        {items.map((item) => (
          <PosterCard
            key={item.ratingKey}
            imageUrl={posterUrl(item.thumb)}
            title={item.title}
            subtitle={getSubtitle(item)}
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
              <rect x={3} y={3} width={7} height={7} rx={1} />
              <rect x={14} y={3} width={7} height={7} rx={1} />
              <rect x={3} y={14} width={7} height={7} rx={1} />
              <rect x={14} y={14} width={7} height={7} rx={1} />
            </svg>
          }
          title="Empty collection"
          subtitle="This collection doesn't have any items yet."
          action={{ label: "Back to Collections", onClick: () => navigate("/collections") }}
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

      {playlistPicker && (
        <PlaylistPicker
          ratingKey={playlistPicker.ratingKey}
          title={playlistPicker.title}
          onClose={() => setPlaylistPicker(null)}
        />
      )}
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

export default CollectionDetail;
