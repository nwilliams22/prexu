import { useState, useMemo, useCallback, useRef, useEffect, createRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useCollections } from "../hooks/useCollections";
import { usePreferences } from "../hooks/usePreferences";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { getImageUrl } from "../services/plex-library";
import LibraryGrid from "../components/LibraryGrid";
import VirtualizedLibraryGrid from "../components/VirtualizedLibraryGrid";
import type { LibraryGridHandle } from "../components/VirtualizedLibraryGrid";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import AlphaJumpBar from "../components/AlphaJumpBar";
import { logger } from "../services/logger";
import type { PlexCollection } from "../types/library";

type SortOption = "alpha-asc" | "alpha-desc" | "items-desc" | "items-asc";

/** Debounce delay for the collections search input (prexu-0szx.7) — avoids
 *  re-filtering/re-sorting the whole collections list on every keystroke. */
const SEARCH_DEBOUNCE_MS = 200;

function CollectionsBrowser() {
  const { server } = useAuth();
  const navigate = useNavigate();
  const { collections, isLoading, error, retry } = useCollections();
  const { preferences } = usePreferences();
  const minSize = preferences.appearance.minCollectionSize;
  useScrollRestoration();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("alpha-asc");

  // Debounce the search query so large collection lists aren't re-filtered
  // and re-sorted on every keystroke (prexu-0szx.7).
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // One imperative grid handle per library section — used to scroll the
  // right section's virtualized grid into view on an alpha-jump (each
  // section renders its own VirtualizedLibraryGrid, so a single flat
  // scrollToIndex can't span sections).
  const gridRefsMap = useRef(new Map<string, React.RefObject<LibraryGridHandle | null>>());
  const getGridRef = useCallback((sectionKey: string) => {
    let ref = gridRefsMap.current.get(sectionKey);
    if (!ref) {
      ref = createRef<LibraryGridHandle>();
      gridRefsMap.current.set(sectionKey, ref);
    }
    return ref;
  }, []);

  const filteredCollections = useMemo(() => {
    const query = debouncedSearchQuery.toLowerCase();
    return collections
      .map((group) => ({
        ...group,
        items: group.items
          .filter((c) => c.childCount >= minSize && c.title.toLowerCase().includes(query))
          .sort((a, b) => {
            switch (sortBy) {
              case "alpha-asc":
                return a.title.localeCompare(b.title);
              case "alpha-desc":
                return b.title.localeCompare(a.title);
              case "items-desc":
                return b.childCount - a.childCount;
              case "items-asc":
                return a.childCount - b.childCount;
              default:
                return 0;
            }
          }),
      }))
      .filter((group) => group.items.length > 0);
  }, [collections, debouncedSearchQuery, sortBy, minSize]);

  const totalCount = useMemo(
    () => filteredCollections.reduce((sum, g) => sum + g.items.length, 0),
    [filteredCollections]
  );

  const allFilteredItems = useMemo(
    () => filteredCollections.flatMap((g) => g.items),
    [filteredCollections]
  );

  const availableLetters = useMemo(() => {
    const letters = new Set<string>();
    for (const item of allFilteredItems) {
      const first = item.title.charAt(0).toUpperCase();
      if (/[A-Z]/.test(first)) {
        letters.add(first);
      } else {
        letters.add("#");
      }
    }
    return letters;
  }, [allFilteredItems]);

  // Scrolls the first matching collection into view. Each section renders
  // its own VirtualizedLibraryGrid (off-screen cards may be unmounted), so
  // we can no longer scan the DOM for a matching node — instead find the
  // matching item's index within its section and drive that section's
  // imperative scrollToIndex handle.
  const handleAlphaJump = useCallback(
    (letter: string) => {
      for (const group of filteredCollections) {
        const idx = group.items.findIndex((c) => {
          const first = c.title.charAt(0).toUpperCase();
          return letter === "#" ? !/[A-Z]/.test(first) : first === letter;
        });
        if (idx >= 0) {
          const ref = gridRefsMap.current.get(group.section.key);
          if (ref?.current) {
            logger.debug("library:scrubber", "collections alpha jump", {
              letter,
              sectionKey: group.section.key,
              index: idx,
            });
            ref.current.scrollToIndex(idx);
            return;
          }
        }
      }
      logger.debug("library:scrubber", "collections alpha jump miss", { letter });
    },
    [filteredCollections],
  );

  const showAlphaJump =
    !isLoading && allFilteredItems.length > 0 && (sortBy === "alpha-asc" || sortBy === "alpha-desc");

  const posterUrl = useCallback(
    (thumb: string) =>
      server ? getImageUrl(server.uri, server.accessToken, thumb, 300, 450) : "",
    [server],
  );

  const renderCollectionItem = useCallback(
    (collection: PlexCollection) => (
      <PosterCard
        ratingKey={collection.ratingKey}
        imageUrl={posterUrl(collection.thumb)}
        title={collection.title}
        subtitle={`${collection.childCount} item${collection.childCount !== 1 ? "s" : ""}`}
        onClick={() => navigate(`/collection/${collection.ratingKey}`)}
      />
    ),
    [posterUrl, navigate],
  );

  const getCollectionKey = useCallback(
    (collection: PlexCollection) => collection.ratingKey,
    [],
  );

  if (!server) return null;

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Collections</h2>

      {error && <ErrorState message={error} onRetry={retry} />}

      {/* Toolbar */}
      {!isLoading && !error && collections.length > 0 && (
        <div style={styles.toolbar}>
          <input
            type="text"
            placeholder="Search collections..."
            aria-label="Search collections"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={styles.searchInput}
          />
          <div style={styles.sortGroup}>
            <label htmlFor="collection-sort" style={styles.sortLabel}>
              Sort:
            </label>
            <select
              id="collection-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              style={styles.sortSelect}
            >
              <option value="alpha-asc">A–Z</option>
              <option value="alpha-desc">Z–A</option>
              <option value="items-desc">Most Items</option>
              <option value="items-asc">Fewest Items</option>
            </select>
          </div>
          <span style={styles.countLabel}>
            {totalCount} collection{totalCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {isLoading && (
        <LibraryGrid>
          {Array.from({ length: 18 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </LibraryGrid>
      )}

      <div>
        {!isLoading &&
          !error &&
          filteredCollections.map((group) => (
            <section key={group.section.key} style={styles.section}>
              <h3 style={styles.sectionTitle}>{group.section.title}</h3>
              <VirtualizedLibraryGrid
                ref={getGridRef(group.section.key)}
                items={group.items}
                renderItem={renderCollectionItem}
                getKey={getCollectionKey}
              />
            </section>
          ))}
      </div>

      {showAlphaJump && (
        <AlphaJumpBar onJump={handleAlphaJump} availableLetters={availableLetters} />
      )}

      {/* Empty state — no collections at all */}
      {!isLoading && !error && collections.length === 0 && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x={3} y={3} width={7} height={7} rx={1} />
              <rect x={14} y={3} width={7} height={7} rx={1} />
              <rect x={3} y={14} width={7} height={7} rx={1} />
              <rect x={14} y={14} width={7} height={7} rx={1} />
            </svg>
          }
          title="No collections"
          subtitle="Collections created in Plex will appear here."
        />
      )}

      {/* Empty state — search has no matches */}
      {!isLoading && !error && collections.length > 0 && filteredCollections.length === 0 && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx={11} cy={11} r={8} />
              <line x1={21} y1={21} x2={16.65} y2={16.65} />
            </svg>
          }
          title="No collections match"
          subtitle="Try a different search term."
          action={{ label: "Clear Search", onClick: () => setSearchQuery("") }}
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
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "1.25rem",
    flexWrap: "wrap",
  },
  searchInput: {
    padding: "0.45rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    width: "220px",
    outline: "none",
  },
  sortGroup: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  sortLabel: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  sortSelect: {
    padding: "0.4rem 0.5rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    outline: "none",
  },
  countLabel: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    marginLeft: "auto",
  },
  section: {
    marginBottom: "2rem",
  },
  sectionTitle: {
    fontSize: "1.1rem",
    fontWeight: 600,
    marginBottom: "0.75rem",
    color: "var(--text-primary)",
  },
};

export default CollectionsBrowser;
