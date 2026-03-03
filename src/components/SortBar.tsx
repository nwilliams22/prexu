import { useBreakpoint, isTabletOrBelow } from "../hooks/useBreakpoint";
import type { SortOption } from "../types/library";

const SORT_OPTIONS: SortOption[] = [
  { label: "Title", value: "titleSort:asc" },
  { label: "Date Added", value: "addedAt:desc" },
  { label: "Rating", value: "rating:desc" },
  { label: "Year", value: "year:desc" },
  { label: "Release Date", value: "originallyAvailableAt:desc" },
];

interface SortBarProps {
  currentSort: string;
  onSortChange: (sort: string) => void;
  totalCount: number;
  label?: string;
}

function SortBar({ currentSort, onSortChange, totalCount, label }: SortBarProps) {
  const bp = useBreakpoint();
  const touchPadding = isTabletOrBelow(bp) ? { padding: "0.6rem 0.75rem" } : {};

  return (
    <div style={styles.bar}>
      <span style={styles.count}>
        {totalCount.toLocaleString()} {label ?? "items"}
      </span>

      <div style={styles.sortGroup}>
        <label htmlFor="sort-select" style={styles.label}>
          Sort by:
        </label>
        <select
          id="sort-select"
          value={currentSort}
          onChange={(e) => onSortChange(e.target.value)}
          style={{ ...styles.select, ...touchPadding }}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1rem",
  },
  count: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
  },
  sortGroup: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  label: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  select: {
    background: "var(--bg-card)",
    color: "var(--text-primary)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "0.4rem 0.6rem",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
};

export default SortBar;
