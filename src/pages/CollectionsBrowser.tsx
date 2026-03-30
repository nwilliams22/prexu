import { useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useCollections } from "../hooks/useCollections";
import { usePreferences } from "../hooks/usePreferences";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { getImageUrl } from "../services/plex-library";
import LibraryGrid from "../components/LibraryGrid";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import AlphaJumpBar from "../components/AlphaJumpBar";

type SortOption = "alpha-asc" | "alpha-desc" | "items-desc" | "items-asc";

function CollectionsBrowser() {
  const { server } = useAuth();
  const navigate = useNavigate();
  const { collections, isLoading, error, retry } = useCollections();
  const { preferences } = usePreferences();
  const minSize = preferences.appearance.minCollectionSize;
  useScrollRestoration();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("alpha-asc");
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const filteredCollections = useMemo(() => {
    const query = searchQuery.toLowerCase();
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
  }, [collections, searchQuery, sortBy, minSize]);

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

  const handleAlphaJump = useCallback((letter: string) => {
    if (!gridContainerRef.current) return;
    const cards = gridContainerRef.current.querySelectorAll("[data-title-sort]");
    for (const card of cards) {
      const titleSort = card.getAttribute("data-title-sort") || "";
      const first = titleSort.charAt(0).toUpperCase();
      const matches = letter === "#" ? !/[A-Z]/.test(first) : first === letter;
      if (matches) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
  }, []);

  const showAlphaJump =
    !isLoading && allFilteredItems.length > 0 && (sortBy === "alpha-asc" || sortBy === "alpha-desc");

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

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

      <div ref={gridContainerRef}>
        {!isLoading &&
          !error &&
          filteredCollections.map((group) => (
            <section key={group.section.key} style={styles.section}>
              <h3 style={styles.sectionTitle}>{group.section.title}</h3>
              <LibraryGrid>
                {group.items.map((collection) => (
                  <div key={collection.ratingKey} data-title-sort={collection.title}>
                    <PosterCard
                      ratingKey={collection.ratingKey}
                      imageUrl={posterUrl(collection.thumb)}
                      title={collection.title}
                      subtitle={`${collection.childCount} item${collection.childCount !== 1 ? "s" : ""}`}
                      onClick={() => navigate(`/collection/${collection.ratingKey}`)}
                    />
                  </div>
                ))}
              </LibraryGrid>
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
