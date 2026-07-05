import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useSearch } from "../hooks/useSearch";
import { getImageUrl } from "../services/plex-library";
import HorizontalRow from "../components/HorizontalRow";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import { getMediaSubtitleShort, isWatched } from "../utils/media-helpers";
import { useScrollRestoration } from "../hooks/useScrollRestoration";

function SearchResults() {
  // useSearch() has no retry/refresh of its own (it dedupes re-fetches of
  // the same query via an internal ref) — bumping this key remounts
  // SearchResultsView, which resets that ref and re-triggers the fetch for
  // the current query as a full retry (prexu-0szx.17).
  const [retryNonce, setRetryNonce] = useState(0);
  return (
    <SearchResultsView
      key={retryNonce}
      onRetry={() => setRetryNonce((n) => n + 1)}
    />
  );
}

function SearchResultsView({ onRetry }: { onRetry: () => void }) {
  const { server } = useAuth();
  const { query, results, isSearching, error } = useSearch();
  const navigate = useNavigate();
  useScrollRestoration();

  useEffect(() => {
    document.title = query ? `"${query}" — Search - Prexu` : "Search - Prexu";
  }, [query]);

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  const thumbUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 400, 225);

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

      {error && <ErrorState message={error} onRetry={onRetry} />}

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
                ratingKey={item.ratingKey}
                imageUrl={
                  isEpisodeHub(hub.type)
                    ? thumbUrl(item.thumb)
                    : posterUrl(item.thumb)
                }
                title={item.title}
                subtitle={getMediaSubtitleShort(item)}
                width={isEpisodeHub(hub.type) ? 230 : 190}
                aspectRatio={isEpisodeHub(hub.type) ? 0.5625 : 1.5}
                watched={isWatched(item)}
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
