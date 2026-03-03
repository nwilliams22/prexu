import { useBreakpoint, isTabletOrBelow } from "../hooks/useBreakpoint";
import type { LibraryFilters, FilterOption } from "../types/library";

interface FilterBarProps {
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  genres: FilterOption[];
  years: FilterOption[];
  contentRatings: FilterOption[];
  isLoading: boolean;
}

function FilterBar({
  filters,
  onFiltersChange,
  genres,
  years,
  contentRatings,
  isLoading,
}: FilterBarProps) {
  const bp = useBreakpoint();
  const touchMode = isTabletOrBelow(bp);
  const touchPadding = touchMode ? { padding: "0.6rem 0.75rem" } : {};

  const hasActiveFilters =
    !!filters.genre ||
    !!filters.year ||
    !!filters.contentRating ||
    !!filters.unwatched;

  const updateFilter = (key: keyof LibraryFilters, value: string | boolean) => {
    const next = { ...filters };
    if (value === "" || value === false) {
      delete next[key];
    } else {
      (next as Record<string, string | boolean>)[key] = value;
    }
    onFiltersChange(next);
  };

  const clearAll = () => onFiltersChange({});

  // Find display titles for active filter chips
  const activeChips: { label: string; onRemove: () => void }[] = [];
  if (filters.genre) {
    const match = genres.find((g) => g.key === filters.genre);
    activeChips.push({
      label: match?.title ?? filters.genre,
      onRemove: () => updateFilter("genre", ""),
    });
  }
  if (filters.year) {
    const match = years.find((y) => y.key === filters.year);
    activeChips.push({
      label: match?.title ?? filters.year,
      onRemove: () => updateFilter("year", ""),
    });
  }
  if (filters.contentRating) {
    const match = contentRatings.find((c) => c.key === filters.contentRating);
    activeChips.push({
      label: match?.title ?? filters.contentRating,
      onRemove: () => updateFilter("contentRating", ""),
    });
  }
  if (filters.unwatched) {
    activeChips.push({
      label: "Unwatched",
      onRemove: () => updateFilter("unwatched", false),
    });
  }

  if (isLoading) return null;

  return (
    <div style={styles.wrapper}>
      {/* Filter controls row */}
      <div style={styles.controls}>
        <select
          aria-label="Genre filter"
          value={filters.genre ?? ""}
          onChange={(e) => updateFilter("genre", e.target.value)}
          style={{ ...styles.select, ...touchPadding }}
        >
          <option value="">All Genres</option>
          {genres.map((g) => (
            <option key={g.key} value={g.key}>
              {g.title}
            </option>
          ))}
        </select>

        <select
          aria-label="Year filter"
          value={filters.year ?? ""}
          onChange={(e) => updateFilter("year", e.target.value)}
          style={{ ...styles.select, ...touchPadding }}
        >
          <option value="">All Years</option>
          {years.map((y) => (
            <option key={y.key} value={y.key}>
              {y.title}
            </option>
          ))}
        </select>

        <select
          aria-label="Rating filter"
          value={filters.contentRating ?? ""}
          onChange={(e) => updateFilter("contentRating", e.target.value)}
          style={{ ...styles.select, ...touchPadding }}
        >
          <option value="">All Ratings</option>
          {contentRatings.map((cr) => (
            <option key={cr.key} value={cr.key}>
              {cr.title}
            </option>
          ))}
        </select>

        <button
          onClick={() => updateFilter("unwatched", !filters.unwatched)}
          aria-pressed={!!filters.unwatched}
          style={{
            ...styles.toggleButton,
            ...touchPadding,
            ...(filters.unwatched ? styles.toggleActive : {}),
          }}
        >
          Unwatched
        </button>

        {hasActiveFilters && (
          <button onClick={clearAll} style={styles.clearButton}>
            Clear Filters
          </button>
        )}
      </div>

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div style={styles.chips}>
          {activeChips.map((chip) => (
            <span key={chip.label} style={styles.chip}>
              {chip.label}
              <button
                onClick={chip.onRemove}
                style={styles.chipRemove}
                aria-label={`Remove ${chip.label} filter`}
              >
                <svg
                  width={10}
                  height={10}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1={18} y1={6} x2={6} y2={18} />
                  <line x1={6} y1={6} x2={18} y2={18} />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    marginBottom: "1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  select: {
    background: "var(--bg-card)",
    color: "var(--text-primary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "0.4rem 0.6rem",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  toggleButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "0.4rem 0.75rem",
    fontSize: "0.85rem",
    cursor: "pointer",
    fontWeight: 500,
  },
  toggleActive: {
    background: "var(--accent)",
    color: "#000",
    borderColor: "var(--accent)",
    fontWeight: 600,
  },
  clearButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    padding: "0.4rem 0.5rem",
    fontSize: "0.8rem",
    cursor: "pointer",
    textDecoration: "underline",
  },
  chips: {
    display: "flex",
    gap: "0.4rem",
    flexWrap: "wrap",
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    background: "var(--bg-card)",
    color: "var(--text-primary)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    padding: "0.2rem 0.6rem",
    fontSize: "0.8rem",
  },
  chipRemove: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    padding: "1px",
    cursor: "pointer",
    borderRadius: "50%",
  },
};

export default FilterBar;
