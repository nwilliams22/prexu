import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePaginatedLibrary } from "../hooks/usePaginatedLibrary";
import { useLibrary } from "../hooks/useLibrary";
import { getImageUrl } from "../services/plex-library";
import LibraryGrid from "../components/LibraryGrid";
import SortBar from "../components/SortBar";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import type { PlexShow } from "../types/library";

function LibraryView() {
  const { sectionId } = useParams<{ sectionId: string }>();
  const { server } = useAuth();
  const { sections } = useLibrary();
  const navigate = useNavigate();
  const [sort, setSort] = useState("titleSort:asc");
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { items, isLoading, isLoadingMore, hasMore, totalSize, error, loadMore } =
    usePaginatedLibrary(sectionId, sort);

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
