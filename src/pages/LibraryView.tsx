import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePaginatedLibrary } from "../hooks/usePaginatedLibrary";
import { useLibrary } from "../hooks/useLibrary";
import { useFilterOptions } from "../hooks/useFilterOptions";
import {
  getImageUrl,
  markAsWatched,
  markAsUnwatched,
} from "../services/plex-library";
import LibraryGrid from "../components/LibraryGrid";
import SortBar from "../components/SortBar";
import FilterBar from "../components/FilterBar";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import ContextMenu from "../components/ContextMenu";
import type { ContextMenuItem } from "../components/ContextMenu";
import SessionCreator from "../components/SessionCreator";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import type { PlexMediaItem, PlexShow, LibraryFilters } from "../types/library";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Initialize sort & filters from URL params
  const sort = searchParams.get("sort") || "titleSort:asc";
  const filters = useMemo<LibraryFilters>(() => {
    const f: LibraryFilters = {};
    const genre = searchParams.get("genre");
    const year = searchParams.get("year");
    const contentRating = searchParams.get("contentRating");
    const unwatched = searchParams.get("unwatched");
    if (genre) f.genre = genre;
    if (year) f.year = year;
    if (contentRating) f.contentRating = contentRating;
    if (unwatched === "1") f.unwatched = true;
    return f;
  }, [searchParams]);

  const { items, isLoading, isLoadingMore, hasMore, totalSize, error, loadMore, retry } =
    usePaginatedLibrary(sectionId, sort, filters);
  const { genres, years, contentRatings, isLoading: filtersLoading } =
    useFilterOptions(sectionId);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sessionCreator, setSessionCreator] =
    useState<SessionCreatorState | null>(null);

  const section = sections.find((s) => s.key === sectionId);

  const updateSearchParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
        }
        return next;
      }, { replace: true });
    },
    [setSearchParams]
  );

  const handleSortChange = useCallback(
    (newSort: string) => {
      updateSearchParams({ sort: newSort === "titleSort:asc" ? undefined : newSort });
    },
    [updateSearchParams]
  );

  const handleFiltersChange = useCallback(
    (newFilters: LibraryFilters) => {
      updateSearchParams({
        genre: newFilters.genre || undefined,
        year: newFilters.year || undefined,
        contentRating: newFilters.contentRating || undefined,
        unwatched: newFilters.unwatched ? "1" : undefined,
      });
    },
    [updateSearchParams]
  );

  const hasActiveFilters =
    !!filters.genre || !!filters.year || !!filters.contentRating || !!filters.unwatched;

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

      {error && <ErrorState message={error} onRetry={retry} />}

      {!isLoading && !error && (
        <>
          <SortBar
            currentSort={sort}
            onSortChange={handleSortChange}
            totalCount={totalSize}
            label={getLabel()}
          />
          <FilterBar
            filters={filters}
            onFiltersChange={handleFiltersChange}
            genres={genres}
            years={years}
            contentRatings={contentRatings}
            isLoading={filtersLoading}
          />
        </>
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

      {/* Empty state */}
      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4M4 7l8 4M4 7v10l8 4m0-10v10" />
            </svg>
          }
          title={hasActiveFilters ? "No items match your filters" : "No items in this library"}
          subtitle={
            hasActiveFilters
              ? "Try adjusting or clearing your filters to see more results."
              : "Add some media to this library section in Plex to see it here."
          }
          action={
            hasActiveFilters
              ? { label: "Clear Filters", onClick: () => handleFiltersChange({}) }
              : undefined
          }
        />
      )}

      {/* Loading more indicator */}
      {isLoadingMore && (
        <p style={styles.loadingMore}>Loading more...</p>
      )}

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

export default LibraryView;
