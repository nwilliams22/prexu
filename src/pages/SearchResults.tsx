import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useSearch } from "../hooks/useSearch";
import { getImageUrl } from "../services/plex-library";
import HorizontalRow from "../components/HorizontalRow";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import type { PlexMediaItem, PlexEpisode } from "../types/library";

function SearchResults() {
  const { server } = useAuth();
  const { query, results, isSearching, error } = useSearch();
  const navigate = useNavigate();

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  const thumbUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 400, 225);

  const getSubtitle = (item: PlexMediaItem): string => {
    if (item.type === "movie") {
      const movie = item as { year?: number };
      return movie.year ? String(movie.year) : "";
    }
    if (item.type === "show") {
      const show = item as { year?: number };
      return show.year ? String(show.year) : "";
    }
    if (item.type === "episode") {
      const ep = item as PlexEpisode;
      return `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")}`;
    }
    return "";
  };

  const isEpisodeHub = (hubType: string): boolean =>
    hubType === "episode" || hubType === "clip";

  return (
    <div style={styles.container}>
      {/* Header */}
      {query ? (
        <h2 style={styles.title}>
          Results for "{query}"
        </h2>
      ) : (
        <h2 style={styles.title}>Search</h2>
      )}

      {error && <ErrorState message={error} />}

      {/* Loading state */}
      {isSearching && (
        <div style={styles.skeletonSection}>
          <div style={styles.skeletonRow}>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      )}

      {/* Results grouped by hub */}
      {!isSearching &&
        results.map((hub) => (
          <HorizontalRow key={hub.hubIdentifier} title={hub.title}>
            {(hub.Metadata ?? []).map((item) => (
              <PosterCard
                key={item.ratingKey}
                imageUrl={
                  isEpisodeHub(hub.type)
                    ? thumbUrl(item.thumb)
                    : posterUrl(item.thumb)
                }
                title={item.title}
                subtitle={getSubtitle(item)}
                width={isEpisodeHub(hub.type) ? 200 : 160}
                aspectRatio={isEpisodeHub(hub.type) ? 0.5625 : 1.5}
                onClick={() => navigate(`/item/${item.ratingKey}`)}
              />
            ))}
          </HorizontalRow>
        ))}

      {/* Empty state */}
      {!isSearching && query && results.length === 0 && !error && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx={11} cy={11} r={8} />
              <line x1={21} y1={21} x2={16.65} y2={16.65} />
            </svg>
          }
          title={`No results found for "${query}"`}
          subtitle="Try a different search term or check your spelling."
        />
      )}

      {/* No query yet */}
      {!query && !isSearching && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx={11} cy={11} r={8} />
              <line x1={21} y1={21} x2={16.65} y2={16.65} />
            </svg>
          }
          title="Start typing to search your libraries"
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
  skeletonSection: {
    marginBottom: "1.75rem",
  },
  skeletonRow: {
    display: "flex",
    gap: "0.75rem",
    overflow: "hidden",
  },
};

export default SearchResults;
