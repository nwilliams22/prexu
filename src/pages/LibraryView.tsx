import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePaginatedLibrary } from "../hooks/usePaginatedLibrary";
import { useLibrary } from "../hooks/useLibrary";
import {
  getImageUrl,
  markAsWatched,
  markAsUnwatched,
} from "../services/plex-library";
import LibraryGrid from "../components/LibraryGrid";
import SortBar from "../components/SortBar";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import ContextMenu from "../components/ContextMenu";
import type { ContextMenuItem } from "../components/ContextMenu";
import SessionCreator from "../components/SessionCreator";
import type { PlexMediaItem, PlexShow } from "../types/library";

interface ContextMenuState {
  position: { x: number; y: number };
  item: PlexMediaItem;
}

interface SessionCreatorState {
  ratingKey: string;
  title: string;
  mediaType: "movie" | "episode";
}

function LibraryView() {
  const { sectionId } = useParams<{ sectionId: string }>();
  const { server } = useAuth();
  const { sections } = useLibrary();
  const navigate = useNavigate();
  const [sort, setSort] = useState("titleSort:asc");
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { items, isLoading, isLoadingMore, hasMore, totalSize, error, loadMore } =
    usePaginatedLibrary(sectionId, sort);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sessionCreator, setSessionCreator] =
    useState<SessionCreatorState | null>(null);

  const section = sections.find((s) => s.key === sectionId);

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

  const getSubtitle = (item: { type: string; year?: number; leafCount?: number }): string => {
    if (item.type === "show") {
      const show = item as PlexShow;
      const parts: string[] = [];
      if (show.year) parts.push(String(show.year));
      if (show.leafCount) parts.push(`${show.leafCount} eps`);
      return parts.join(" · ");
    }
    if (item.year) return String(item.year);
    return "";
  };

  const getLabel = (): string => {
    if (!section) return "items";
    switch (section.type) {
      case "movie":
        return "movies";
      case "show":
        return "shows";
      case "artist":
        return "artists";
      case "photo":
        return "photos";
      default:
        return "items";
    }
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

      // Watch Together (movies & episodes, not shows)
      if (item.type === "movie" || item.type === "episode") {
        menuItems.push({
          label: "Watch Together...",
          dividerAbove: true,
          onClick: () => {
            setSessionCreator({
              ratingKey: item.ratingKey,
              title: item.title,
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
      <h2 style={styles.title}>{section?.title ?? `Library ${sectionId}`}</h2>

      {error && <p style={styles.error}>{error}</p>}

      {!isLoading && (
        <SortBar
          currentSort={sort}
          onSortChange={setSort}
          totalCount={totalSize}
          label={getLabel()}
        />
      )}

      <LibraryGrid>
        {/* Initial loading skeletons */}
        {isLoading &&
          Array.from({ length: 24 }).map((_, i) => <SkeletonCard key={i} />)}

        {/* Actual items */}
        {items.map((item) => (
          <PosterCard
            key={item.ratingKey}
            imageUrl={posterUrl(item.thumb)}
            title={item.title}
            subtitle={getSubtitle(item as { type: string; year?: number; leafCount?: number })}
            onClick={() => navigate(`/item/${item.ratingKey}`)}
            showMoreButton
            onContextMenu={(e) => openContextMenu(e, item)}
            onMoreClick={(e) => openContextMenu(e, item)}
          />
        ))}

        {/* Loading more skeletons */}
        {isLoadingMore &&
          Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={`more-${i}`} />
          ))}
      </LibraryGrid>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} style={styles.sentinel} />

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          items={buildMenuItems(contextMenu.item)}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Watch Together session creator */}
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
  error: {
    color: "var(--error)",
    fontSize: "0.9rem",
    marginBottom: "1rem",
  },
  sentinel: {
    height: "1px",
  },
};

export default LibraryView;
