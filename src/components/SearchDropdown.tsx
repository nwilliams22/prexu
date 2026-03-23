import type { SearchSuggestion } from "../hooks/useSearchSuggestions";
import { useAuth } from "../hooks/useAuth";
import { getImageUrl } from "../services/plex-library/images";

interface SearchDropdownProps {
  recentSearches: string[];
  suggestions: SearchSuggestion[];
  isLoading: boolean;
  activeIndex: number;
  query: string;
  onSelectRecent: (query: string) => void;
  onRemoveRecent: (query: string) => void;
  onSelectSuggestion: (suggestion: SearchSuggestion) => void;
  onSearchAll: (query: string) => void;
}

const DROPDOWN_ID = "search-dropdown-listbox";

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <strong key={i} style={{ color: "var(--text-primary)" }}>{part}</strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function typeLabel(type: string): string {
  switch (type) {
    case "movie": return "Movie";
    case "show": return "Show";
    case "episode": return "Episode";
    case "season": return "Season";
    case "artist": return "Artist";
    case "album": return "Album";
    case "track": return "Track";
    case "clip": return "Clip";
    default: return type;
  }
}

function SearchDropdown({
  recentSearches,
  suggestions,
  isLoading,
  activeIndex,
  query,
  onSelectRecent,
  onRemoveRecent,
  onSelectSuggestion,
  onSearchAll,
}: SearchDropdownProps) {
  const { server } = useAuth();
  const trimmed = query.trim();

  const filteredRecents = trimmed
    ? recentSearches.filter((s) => s.toLowerCase().includes(trimmed.toLowerCase()))
    : recentSearches;

  const hasRecents = filteredRecents.length > 0;
  const hasSuggestions = suggestions.length > 0;
  const isEmpty = !hasRecents && !hasSuggestions && !isLoading;

  if (isEmpty && !trimmed) return null;

  // Flat index mapping: recents first, then suggestions
  let flatIndex = 0;

  return (
    <div
      id={DROPDOWN_ID}
      role="listbox"
      style={styles.dropdown}
      onMouseDown={(e) => e.preventDefault()} // prevent blur on click
    >
      {/* Recent Searches */}
      {hasRecents && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}>Recent Searches</div>
          {filteredRecents.map((term) => {
            const idx = flatIndex++;
            return (
              <div
                key={`recent-${term}`}
                id={`search-option-${idx}`}
                role="option"
                aria-selected={idx === activeIndex}
                style={{
                  ...styles.item,
                  ...(idx === activeIndex ? styles.itemActive : {}),
                }}
                onClick={() => onSelectRecent(term)}
              >
                <svg
                  aria-hidden="true"
                  width={14}
                  height={14}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  style={{ flexShrink: 0, opacity: 0.5 }}
                >
                  <circle cx={12} cy={12} r={10} />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span style={styles.itemText}>
                  {highlightMatch(term, trimmed)}
                </span>
                <button
                  style={styles.removeButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveRecent(term);
                  }}
                  aria-label={`Remove ${term} from recent searches`}
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1={18} y1={6} x2={6} y2={18} />
                    <line x1={6} y1={6} x2={18} y2={18} />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Live Suggestions */}
      {(hasSuggestions || isLoading) && (
        <div style={styles.section}>
          {hasRecents && <div style={styles.sectionDivider} />}
          <div style={styles.sectionHeader}>Suggestions</div>
          {isLoading && !hasSuggestions && (
            <div style={styles.loadingRow}>Searching...</div>
          )}
          {suggestions.map((s) => {
            const idx = flatIndex++;
            const thumb = server
              ? getImageUrl(server.uri, server.accessToken, s.thumb, 64, 64)
              : "";
            return (
              <div
                key={`suggestion-${s.ratingKey}`}
                id={`search-option-${idx}`}
                role="option"
                aria-selected={idx === activeIndex}
                style={{
                  ...styles.item,
                  ...(idx === activeIndex ? styles.itemActive : {}),
                }}
                onClick={() => onSelectSuggestion(s)}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    style={styles.thumb}
                    loading="lazy"
                  />
                ) : (
                  <div style={{ ...styles.thumb, background: "var(--border)" }} />
                )}
                <div style={styles.suggestionInfo}>
                  <span style={styles.itemText}>
                    {highlightMatch(s.title, trimmed)}
                  </span>
                  <span style={styles.typeBadge}>
                    {typeLabel(s.type)}
                    {s.year ? ` \u00b7 ${s.year}` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Search all results */}
      {trimmed && (
        <>
          <div style={styles.sectionDivider} />
          <div
            id={`search-option-${flatIndex}`}
            role="option"
            aria-selected={flatIndex === activeIndex}
            style={{
              ...styles.item,
              ...(flatIndex === activeIndex ? styles.itemActive : {}),
            }}
            onClick={() => onSearchAll(trimmed)}
          >
            <svg
              aria-hidden="true"
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              style={{ flexShrink: 0, opacity: 0.5 }}
            >
              <circle cx={11} cy={11} r={8} />
              <line x1={21} y1={21} x2={16.65} y2={16.65} />
            </svg>
            <span style={styles.itemText}>
              Search all for &ldquo;{trimmed}&rdquo;
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** Get the total count of interactive items in the dropdown */
export function getDropdownItemCount(
  recentSearches: string[],
  suggestions: SearchSuggestion[],
  query: string
): number {
  const trimmed = query.trim();
  const filteredRecents = trimmed
    ? recentSearches.filter((s) => s.toLowerCase().includes(trimmed.toLowerCase()))
    : recentSearches;
  return filteredRecents.length + suggestions.length + (trimmed ? 1 : 0);
}

export { DROPDOWN_ID };
export default SearchDropdown;

const styles: Record<string, React.CSSProperties> = {
  dropdown: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
    zIndex: 100,
    maxHeight: "400px",
    overflowY: "auto",
    padding: "4px 0",
  },
  section: {
    padding: 0,
  },
  sectionHeader: {
    fontSize: "0.7rem",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    color: "var(--text-secondary)",
    padding: "6px 12px 4px",
    letterSpacing: "0.05em",
  },
  sectionDivider: {
    height: "1px",
    background: "var(--border)",
    margin: "4px 8px",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 12px",
    cursor: "pointer",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    transition: "background 0.1s",
  },
  itemActive: {
    background: "rgba(229, 160, 13, 0.12)",
    color: "var(--text-primary)",
  },
  itemText: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  removeButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    color: "var(--text-secondary)",
    padding: "2px",
    borderRadius: "4px",
    flexShrink: 0,
    opacity: 0.5,
    border: "none",
    cursor: "pointer",
  },
  thumb: {
    width: "32px",
    height: "32px",
    borderRadius: "4px",
    objectFit: "cover" as const,
    flexShrink: 0,
  },
  suggestionInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    gap: "1px",
  },
  typeBadge: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
    opacity: 0.7,
  },
  loadingRow: {
    padding: "8px 12px",
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    opacity: 0.7,
  },
};
