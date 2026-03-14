import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePaginatedLibrary } from "../hooks/usePaginatedLibrary";
import { useLibrary } from "../hooks/useLibrary";
import { useFilterOptions } from "../hooks/useFilterOptions";
import { useMediaContextMenu } from "../hooks/useMediaContextMenu";
import { usePlayAction } from "../hooks/usePlayAction";
import { getImageUrl } from "../services/plex-library";
import LibraryGrid from "../components/LibraryGrid";
import SortBar from "../components/SortBar";
import FilterBar from "../components/FilterBar";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import ShowExpansionPanel from "../components/ShowExpansionPanel";
import AlphaJumpBar from "../components/AlphaJumpBar";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import type { PlexMediaItem, PlexShow, LibraryFilters } from "../types/library";

/** Pure helper — is this item fully watched? */
function isWatched(item: PlexMediaItem): boolean {
  const asMovie = item as { viewCount?: number };
  if (asMovie.viewCount !== undefined) return asMovie.viewCount > 0;
  const asShow = item as { viewedLeafCount?: number; leafCount?: number };
  if (asShow.viewedLeafCount !== undefined && asShow.leafCount !== undefined) {
    return asShow.leafCount > 0 && asShow.viewedLeafCount >= asShow.leafCount;
  }
  return false;
}

/** Pure helper — number of unwatched episodes (shows/seasons), or undefined */
function getUnwatchedCount(item: PlexMediaItem): number | undefined {
  const asShow = item as { viewedLeafCount?: number; leafCount?: number };
  if (asShow.leafCount !== undefined && asShow.viewedLeafCount !== undefined) {
    const count = asShow.leafCount - asShow.viewedLeafCount;
    return count > 0 ? count : undefined;
  }
  return undefined;
}

/** Pure helper — subtitle for a library item (year, episode count) */
function getSubtitle(item: { type: string; year?: number; leafCount?: number }): string {
  if (item.type === "show") {
    const show = item as PlexShow;
    const parts: string[] = [];
    if (show.year) parts.push(String(show.year));
    if (show.leafCount) parts.push(`${show.leafCount} eps`);
    return parts.join(" · ");
  }
  if (item.year) return String(item.year);
  return "";
}

function LibraryView() {
  const { sectionId } = useParams<{ sectionId: string }>();
  const { server } = useAuth();
  const { sections } = useLibrary();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const section = sections.find((s) => s.key === sectionId);

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
    if (section) f.sectionType = section.type as LibraryFilters["sectionType"];
    return f;
  }, [searchParams, section]);

  // Load all items at once when sorted alphabetically on movie/show libraries
  // so the alpha jump bar can access all letters
  const shouldLoadAll =
    (section?.type === "movie" || section?.type === "show") &&
    sort.startsWith("titleSort:");

  const { items, isLoading, isLoadingMore, hasMore, totalSize, error, loadMore, retry } =
    usePaginatedLibrary(sectionId, sort, filters, {
      loadAll: shouldLoadAll,
      type: section?.type === "show" ? 2 : section?.type === "movie" ? 1 : undefined,
    });
  const { genres, years, contentRatings, isLoading: filtersLoading } =
    useFilterOptions(sectionId);
  const { openContextMenu, overlays: menuOverlays } = useMediaContextMenu();
  const { getPlayHandler, playOverlay } = usePlayAction();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Compute available first-letters from loaded items for the alpha jump bar
  const availableLetters = useMemo(() => {
    const letters = new Set<string>();
    for (const item of items) {
      const first = ((item as { titleSort?: string }).titleSort || item.title || "")
        .charAt(0)
        .toUpperCase();
      if (/[A-Z]/.test(first)) {
        letters.add(first);
      } else {
        letters.add("#");
      }
    }
    return letters;
  }, [items]);

  const handleAlphaJump = useCallback(
    (letter: string) => {
      if (!gridContainerRef.current) return;
      // Find the first card element whose data-title starts with this letter
      const cards = gridContainerRef.current.querySelectorAll("[data-title-sort]");
      for (const card of cards) {
        const titleSort = card.getAttribute("data-title-sort") || "";
        const first = titleSort.charAt(0).toUpperCase();
        const matches =
          letter === "#"
            ? !/[A-Z]/.test(first)
            : first === letter;
        if (matches) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
      }
    },
    []
  );

  // Show alpha jump bar for movie and show libraries when sorted alphabetically
  const showAlphaJump =
    !isLoading &&
    items.length > 0 &&
    (section?.type === "movie" || section?.type === "show") &&
    sort.startsWith("titleSort:");

  useEffect(() => {
    if (section) document.title = `${section.title} - Prexu`;
  }, [section]);

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

      <div ref={gridContainerRef}>
      <LibraryGrid>
        {/* Initial loading skeletons */}
        {isLoading &&
          Array.from({ length: 24 }).map((_, i) => <SkeletonCard key={i} />)}

        {/* Actual items */}
        {items.map((item) => (
          <React.Fragment key={item.ratingKey}>
            <div data-title-sort={(item as { titleSort?: string }).titleSort || item.title}>
            <PosterCard
              imageUrl={posterUrl(item.thumb)}
              title={item.title}
              subtitle={getSubtitle(item as { type: string; year?: number; leafCount?: number })}
              watched={isWatched(item)}
              unwatchedCount={getUnwatchedCount(item)}
              onClick={() => navigate(`/item/${item.ratingKey}`)}
              onPlay={getPlayHandler(item)}
              showMoreButton
              onContextMenu={(e) => openContextMenu(e, item)}
              onMoreClick={(e) => openContextMenu(e, item)}
              onExpand={
                item.type === "show"
                  ? () =>
                      setExpandedKey(
                        expandedKey === item.ratingKey ? null : item.ratingKey
                      )
                  : undefined
              }
              isExpanded={expandedKey === item.ratingKey}
            />
            </div>
            {expandedKey === item.ratingKey && (
              <div style={{ gridColumn: "1 / -1" }}>
                <ShowExpansionPanel
                  ratingKey={item.ratingKey}
                  onClose={() => setExpandedKey(null)}
                  onNavigateToShow={(key) => navigate(`/item/${key}`)}
                  onNavigateToSeason={(key) => navigate(`/item/${key}`)}
                />
              </div>
            )}
          </React.Fragment>
        ))}

        {/* Loading more skeletons */}
        {isLoadingMore &&
          Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={`more-${i}`} />
          ))}
      </LibraryGrid>
      </div>

      {/* Alpha jump bar */}
      {showAlphaJump && (
        <AlphaJumpBar
          onJump={handleAlphaJump}
          availableLetters={availableLetters}
        />
      )}

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
