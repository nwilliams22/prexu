import { useEffect, useRef, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useWatchHistory } from "../hooks/useWatchHistory";
import {
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
import type { PlexMediaItem, PlexEpisode } from "../types/library";

interface ContextMenuState {
  position: { x: number; y: number };
  item: PlexMediaItem;
}

interface SessionCreatorState {
  ratingKey: string;
  title: string;
  mediaType: "movie" | "episode";
}

function WatchHistory() {
  const { server } = useAuth();
  const navigate = useNavigate();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { items, isLoading, isLoadingMore, hasMore, totalSize, error, loadMore, retry } =
    useWatchHistory();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sessionCreator, setSessionCreator] =
    useState<SessionCreatorState | null>(null);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          loadMore();
        }
      },
      { rootMargin: "400px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, loadMore]);

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
    const movie = item as { year?: number };
    return movie.year ? String(movie.year) : "";
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

  const isWatched = (item: PlexMediaItem): boolean => {
    const asMovie = item as { viewCount?: number };
    return asMovie.viewCount !== undefined && asMovie.viewCount > 0;
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
      <h2 style={styles.title}>Watch History</h2>

      {error && <ErrorState message={error} onRetry={retry} />}

      {!isLoading && !error && totalSize > 0 && (
        <p style={styles.count}>
          {totalSize.toLocaleString()} watched
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
            watched={isWatched(item)}
            onClick={() => navigate(`/item/${item.ratingKey}`)}
            showMoreButton
            onContextMenu={(e) => openContextMenu(e, item)}
            onMoreClick={(e) => openContextMenu(e, item)}
          />
        ))}

        {isLoadingMore &&
          Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={`more-${i}`} />
          ))}
      </LibraryGrid>

      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx={12} cy={12} r={10} />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
          title="No watch history"
          subtitle="Items you watch will appear here."
        />
      )}

      {isLoadingMore && (
        <p style={styles.loadingMore}>Loading more...</p>
      )}

      <div ref={sentinelRef} style={styles.sentinel} />

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
  title: {
    fontSize: "1.5rem",
    fontWeight: 600,
    marginBottom: "1rem",
  },
  count: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    marginBottom: "1rem",
  },
  loadingMore: {
    textAlign: "center",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    padding: "0.5rem 0",
  },
  sentinel: {
    height: "1px",
  },
};

export default WatchHistory;
