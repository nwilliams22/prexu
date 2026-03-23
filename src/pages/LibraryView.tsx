import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePaginatedLibrary } from "../hooks/usePaginatedLibrary";
import { useLibrary } from "../hooks/useLibrary";
import { useFilterOptions } from "../hooks/useFilterOptions";
import { useMediaContextMenu } from "../hooks/useMediaContextMenu";
import { usePlayAction } from "../hooks/usePlayAction";
import { useSectionCollections } from "../hooks/useCollections";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { usePreferences } from "../hooks/usePreferences";
import { useParentalControls } from "../hooks/useParentalControls";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { getImageUrl, getPlaceholderUrl, getImageSrcSet } from "../services/plex-library";
import LibraryGrid from "../components/LibraryGrid";
import VirtualizedLibraryGrid from "../components/VirtualizedLibraryGrid";
import FilterBar from "../components/FilterBar";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import ShowExpansionPanel from "../components/ShowExpansionPanel";
import AlphaJumpBar from "../components/AlphaJumpBar";
import SegmentedControl from "../components/SegmentedControl";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import {
  getMediaSubtitle,
  isWatched,
  getUnwatchedCount,
} from "../utils/media-helpers";
import type { PlexMediaItem, PlexMediaInfo, PlexCollection, LibraryFilters } from "../types/library";
import { getMediaBadges, extractStreamsForBadges } from "../utils/media-badges";
import type { MediaBadge } from "../utils/media-badges";

function getItemMediaBadges(item: PlexMediaItem): MediaBadge[] | undefined {
  const media = (item as { Media?: PlexMediaInfo[] }).Media?.[0];
  if (!media) return undefined;
  const { videoStream, audioStream } = extractStreamsForBadges(media);
  const badges = getMediaBadges(media, videoStream, audioStream);
  return badges.length > 0 ? badges : undefined;
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
    const resolution = searchParams.get("resolution");
    const unwatched = searchParams.get("unwatched");
    if (genre) f.genre = genre;
    if (year) f.year = year;
    if (contentRating) f.contentRating = contentRating;
    if (resolution) f.resolution = resolution;
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
  const { genres, years, contentRatings, resolutions, isLoading: filtersLoading } =
    useFilterOptions(sectionId);
  const { restrictionsEnabled, filterByRating } = useParentalControls();
  const { openContextMenu, overlays: menuOverlays } = useMediaContextMenu();
  const { getPlayHandler, playOverlay } = usePlayAction();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Apply parental controls client-side filtering
  const filteredItems = useMemo(
    () => filterByRating(items as (PlexMediaItem & { contentRating?: string })[]),
    [items, filterByRating],
  );

  // --- Collections view state ---
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const { preferences } = usePreferences();
  const minCollectionSize = preferences.appearance.minCollectionSize;
  useScrollRestoration();
  const showViewToggle = section?.type === "movie";
  const viewMode = searchParams.get("view") === "collections" ? "collections" : "library";
  const {
    collections: sectionCollections,
    watchedMap: collectionWatchedMap,
    isLoading: collectionsLoading,
    error: collectionsError,
    retry: collectionsRetry,
  } = useSectionCollections(showViewToggle ? sectionId : undefined);

  const [collectionSearch, setCollectionSearch] = useState("");
  const [collectionSort, setCollectionSort] = useState<
    "alpha-asc" | "alpha-desc" | "items-desc" | "items-asc"
  >("alpha-asc");
  const [collectionsUnwatchedOnly, setCollectionsUnwatchedOnly] = useState(false);

  const filteredCollections = useMemo(() => {
    let list = sectionCollections.filter((c) => (c.childCount ?? 0) >= minCollectionSize);
    if (collectionSearch) {
      const q = collectionSearch.toLowerCase();
      list = list.filter((c) => c.title.toLowerCase().includes(q));
    }
    if (collectionsUnwatchedOnly) {
      list = list.filter((c) => {
        // Hide collections where all items are watched
        const fullyWatched = collectionWatchedMap[c.ratingKey];
        return fullyWatched !== true;
      });
    }
    const sorted = [...list];
    switch (collectionSort) {
      case "alpha-asc":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "alpha-desc":
        sorted.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case "items-desc":
        sorted.sort((a, b) => (b.childCount ?? 0) - (a.childCount ?? 0));
        break;
      case "items-asc":
        sorted.sort((a, b) => (a.childCount ?? 0) - (b.childCount ?? 0));
        break;
    }
    return sorted;
  }, [sectionCollections, collectionSearch, collectionSort, collectionsUnwatchedOnly, collectionWatchedMap, minCollectionSize]);

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
    if (section) {
      document.title = viewMode === "collections"
        ? `${section.title} Collections - Prexu`
        : `${section.title} - Prexu`;
    }
  }, [section, viewMode]);

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
        resolution: newFilters.resolution || undefined,
        unwatched: newFilters.unwatched ? "1" : undefined,
      });
    },
    [updateSearchParams]
  );

  const hasActiveFilters =
    !!filters.genre || !!filters.year || !!filters.contentRating || !!filters.resolution || !!filters.unwatched;

  const posterUrl = useCallback(
    (thumb: string) =>
      server ? getImageUrl(server.uri, server.accessToken, thumb, 300, 450) : "",
    [server],
  );

  const placeholderForPoster = useCallback(
    (thumb: string) =>
      server ? getPlaceholderUrl(server.uri, server.accessToken, thumb) : "",
    [server],
  );

  const srcSetForPoster = useCallback(
    (thumb: string) =>
      server ? getImageSrcSet(server.uri, server.accessToken, thumb, 300) : "",
    [server],
  );

  const renderLibraryItem = useCallback(
    (item: PlexMediaItem) => (
      <div data-title-sort={(item as { titleSort?: string }).titleSort || item.title}>
        <PosterCard
          ratingKey={item.ratingKey}
          imageUrl={posterUrl(item.thumb)}
          placeholderUrl={placeholderForPoster(item.thumb)}
          srcSet={srcSetForPoster(item.thumb)}
          title={item.title}
          subtitle={getMediaSubtitle(item, { showEpisodeCount: true })}
          watched={isWatched(item)}
          unwatchedCount={getUnwatchedCount(item)}
          onClick={() => navigate(`/item/${item.ratingKey}`)}
          onPlay={getPlayHandler(item)}
          mediaBadges={getItemMediaBadges(item)}
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
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expandedKey, navigate, openContextMenu, getPlayHandler, posterUrl],
  );

  const renderExpansion = useCallback(
    (item: PlexMediaItem) => (
      <ShowExpansionPanel
        ratingKey={item.ratingKey}
        onClose={() => setExpandedKey(null)}
        onNavigateToShow={(key) => navigate(`/item/${key}`)}
        onNavigateToSeason={(key) => navigate(`/item/${key}`)}
      />
    ),
    [navigate],
  );

  const getItemKey = useCallback((item: PlexMediaItem, _index: number) => item.ratingKey, []);

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

      {/* Segmented control: Library / Collections */}
      {showViewToggle && (
        <SegmentedControl
          options={[
            { label: "Library", value: "library" },
            { label: "Collections", value: "collections" },
          ]}
          value={viewMode}
          onChange={(v) => updateSearchParams({ view: v === "library" ? undefined : v })}
          style={{ marginBottom: "1rem" }}
        />
      )}

      {/* ========= LIBRARY VIEW ========= */}
      {viewMode === "library" && (
        <>
          {error && <ErrorState message={error} onRetry={retry} />}

          {!isLoading && !error && (
            <>
              <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "0.5rem", display: "block" }}>
                {totalSize.toLocaleString()} {getLabel()}
              </span>
              <FilterBar
                filters={filters}
                onFiltersChange={handleFiltersChange}
                genres={genres}
                years={years}
                contentRatings={contentRatings}
                resolutions={resolutions}
                isLoading={filtersLoading}
                hideContentRating={restrictionsEnabled}
                currentSort={sort}
                onSortChange={handleSortChange}
              />
            </>
          )}

          <div ref={gridContainerRef}>
            <VirtualizedLibraryGrid
              items={filteredItems}
              renderItem={renderLibraryItem}
              getKey={getItemKey}
              expandedKey={expandedKey}
              renderExpansion={renderExpansion}
              header={
                isLoading
                  ? Array.from({ length: 24 }).map((_, i) => <SkeletonCard key={i} />)
                  : undefined
              }
              footer={
                isLoadingMore
                  ? Array.from({ length: 12 }).map((_, i) => (
                      <SkeletonCard key={`more-${i}`} />
                    ))
                  : undefined
              }
            />
          </div>

          {showAlphaJump && (
            <AlphaJumpBar
              onJump={handleAlphaJump}
              availableLetters={availableLetters}
            />
          )}

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

          {isLoadingMore && (
            <p style={styles.loadingMore}>Loading more...</p>
          )}

          <div ref={sentinelRef} style={styles.sentinel} />
        </>
      )}

      {/* ========= COLLECTIONS VIEW ========= */}
      {viewMode === "collections" && (
        <>
          {collectionsError && (
            <ErrorState message={collectionsError} onRetry={collectionsRetry} />
          )}

          {!collectionsLoading && !collectionsError && (
            <div style={{ ...styles.collectionsToolbar, ...(mobile ? { flexDirection: "column" as const } : {}) }}>
              <input
                type="text"
                placeholder="Search collections..."
                value={collectionSearch}
                onChange={(e) => setCollectionSearch(e.target.value)}
                style={{ ...styles.collectionsSearchInput, ...(mobile ? { width: "100%" } : {}) }}
              />
              <div style={styles.collectionsSortGroup}>
                <label htmlFor="collection-sort" style={styles.collectionsSortLabel}>
                  Sort:
                </label>
                <select
                  id="collection-sort"
                  value={collectionSort}
                  onChange={(e) =>
                    setCollectionSort(
                      e.target.value as typeof collectionSort
                    )
                  }
                  style={styles.collectionsSortSelect}
                >
                  <option value="alpha-asc">A–Z</option>
                  <option value="alpha-desc">Z–A</option>
                  <option value="items-desc">Most Items</option>
                  <option value="items-asc">Fewest Items</option>
                </select>
              </div>
              <button
                onClick={() => setCollectionsUnwatchedOnly((v) => !v)}
                style={collectionsUnwatchedOnly ? styles.unwatchedToggleActive : styles.unwatchedToggle}
                aria-pressed={collectionsUnwatchedOnly}
                title="Show only collections with unwatched items"
              >
                Unwatched
              </button>
              <span style={styles.collectionsCount}>
                {filteredCollections.length} collection{filteredCollections.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}

          <LibraryGrid>
            {collectionsLoading &&
              Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}

            {filteredCollections.map((c: PlexCollection) => (
              <PosterCard
                key={c.ratingKey}
                ratingKey={c.ratingKey}
                imageUrl={c.thumb ? posterUrl(c.thumb) : ""}
                title={c.title}
                subtitle={`${c.childCount ?? 0} item${(c.childCount ?? 0) !== 1 ? "s" : ""}`}
                onClick={() => navigate(`/collection/${c.ratingKey}`)}
              />
            ))}
          </LibraryGrid>

          {!collectionsLoading && !collectionsError && filteredCollections.length === 0 && (
            <EmptyState
              icon={
                <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <rect x={3} y={3} width={7} height={7} rx={1} />
                  <rect x={14} y={3} width={7} height={7} rx={1} />
                  <rect x={3} y={14} width={7} height={7} rx={1} />
                  <rect x={14} y={14} width={7} height={7} rx={1} />
                </svg>
              }
              title={
                collectionSearch
                  ? "No collections match your search"
                  : "No collections in this library"
              }
              subtitle={
                collectionSearch
                  ? "Try a different search term."
                  : "Create collections in Plex to organize your media."
              }
              action={
                collectionSearch
                  ? { label: "Clear Search", onClick: () => setCollectionSearch("") }
                  : undefined
              }
            />
          )}
        </>
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
  /* --- Collections toolbar --- */
  collectionsToolbar: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "1rem",
    flexWrap: "wrap",
  },
  collectionsSearchInput: {
    width: "220px",
    padding: "0.4rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    outline: "none",
  },
  collectionsSortGroup: {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
  },
  collectionsSortLabel: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
  },
  collectionsSortSelect: {
    padding: "0.4rem 0.5rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    outline: "none",
    cursor: "pointer",
  },
  unwatchedToggle: {
    padding: "0.35rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.8rem",
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
  },
  unwatchedToggleActive: {
    padding: "0.35rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid var(--accent)",
    background: "rgba(229, 160, 13, 0.12)",
    color: "var(--accent)",
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
  },
  collectionsCount: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    marginLeft: "auto",
  },
};

export default LibraryView;
