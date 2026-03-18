/**
 * Displays TMDb search results as a scrollable list of clickable items.
 */

import type { TmdbMovie, TmdbTvShow } from "../../types/content-request";
import { getTmdbImageUrl } from "../../services/tmdb";

interface TmdbSearchResultsProps {
  results: (TmdbMovie | TmdbTvShow)[];
  isSearching: boolean;
  searchError: string | null;
  query: string;
  onSelect: (item: TmdbMovie | TmdbTvShow) => void;
}

function TmdbSearchResults({
  results,
  isSearching,
  searchError,
  query,
  onSelect,
}: TmdbSearchResultsProps) {
  return (
    <div style={styles.resultsList}>
      {isSearching && <p style={styles.loadingText}>Searching...</p>}
      {searchError && <p style={styles.errorText}>{searchError}</p>}
      {!isSearching && results.length === 0 && query.length >= 2 && (
        <p style={styles.emptyText}>No results found</p>
      )}
      {results.map((item) => {
        const isMovie = "title" in item;
        const title = isMovie ? item.title : (item as TmdbTvShow).name;
        const year = isMovie
          ? item.release_date?.split("-")[0]
          : (item as TmdbTvShow).first_air_date?.split("-")[0];
        const posterUrl = getTmdbImageUrl(item.poster_path, "w92");

        return (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            style={styles.resultItem}
          >
            {posterUrl ? (
              <img src={posterUrl} alt="" style={styles.resultPoster} />
            ) : (
              <div style={styles.resultPosterPlaceholder} />
            )}
            <div style={styles.resultInfo}>
              <span style={styles.resultTitle}>{title}</span>
              <span style={styles.resultYear}>{year || "Unknown year"}</span>
              {item.overview && (
                <span style={styles.resultOverview}>
                  {item.overview.length > 100
                    ? item.overview.slice(0, 100) + "..."
                    : item.overview}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  resultsList: {
    flex: 1,
    overflowY: "auto",
    maxHeight: "300px",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  resultItem: {
    display: "flex",
    gap: "0.75rem",
    padding: "0.5rem",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: "6px",
    textAlign: "left",
    cursor: "pointer",
    color: "var(--text-primary)",
    alignItems: "flex-start",
    width: "100%",
  },
  resultPoster: {
    width: "46px",
    height: "69px",
    borderRadius: "4px",
    objectFit: "cover",
    flexShrink: 0,
    background: "rgba(255,255,255,0.05)",
  },
  resultPosterPlaceholder: {
    width: "46px",
    height: "69px",
    borderRadius: "4px",
    flexShrink: 0,
    background: "rgba(255,255,255,0.05)",
  },
  resultInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    overflow: "hidden",
    flex: 1,
  },
  resultTitle: {
    fontSize: "0.85rem",
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  resultYear: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
  },
  resultOverview: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
    lineHeight: 1.3,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  loadingText: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    textAlign: "center",
    padding: "1rem 0",
    margin: 0,
  },
  errorText: {
    fontSize: "0.8rem",
    color: "var(--error)",
    margin: 0,
  },
  emptyText: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    textAlign: "center",
    padding: "1rem 0",
    margin: 0,
  },
};

export default TmdbSearchResults;
