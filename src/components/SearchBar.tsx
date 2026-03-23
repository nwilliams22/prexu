import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { useSearchSuggestions } from "../hooks/useSearchSuggestions";
import type { SearchSuggestion } from "../hooks/useSearchSuggestions";
import {
  getRecentSearches,
  addRecentSearch,
  removeRecentSearch,
} from "../services/storage";
import SearchDropdown, { DROPDOWN_ID, getDropdownItemCount } from "./SearchDropdown";

const DEBOUNCE_MS = 300;

function SearchBar() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const { suggestions, isLoading } = useSearchSuggestions(value, isDropdownOpen);

  // Sync input when navigating away from search page
  useEffect(() => {
    const q = searchParams.get("q") ?? "";
    setValue(q);
  }, [searchParams]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  const loadRecents = useCallback(async () => {
    const recents = await getRecentSearches();
    setRecentSearches(recents);
  }, []);

  const closeDropdown = useCallback(() => {
    setIsDropdownOpen(false);
    setActiveIndex(-1);
  }, []);

  const navigateToSearch = useCallback(
    (q: string) => {
      closeDropdown();
      if (q.trim()) {
        navigate(`/search?q=${encodeURIComponent(q.trim())}`, { replace: true });
        addRecentSearch(q.trim()).then(setRecentSearches);
      }
    },
    [navigate, closeDropdown]
  );

  const navigateToItem = useCallback(
    (suggestion: SearchSuggestion) => {
      closeDropdown();
      const path =
        suggestion.type === "episode" || suggestion.type === "clip"
          ? `/item/${suggestion.ratingKey}`
          : `/item/${suggestion.ratingKey}`;
      navigate(path);
      addRecentSearch(suggestion.title).then(setRecentSearches);
    },
    [navigate, closeDropdown]
  );

  const handleFocus = () => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    setIsDropdownOpen(true);
    loadRecents();
  };

  const handleBlur = () => {
    blurTimeoutRef.current = setTimeout(() => {
      closeDropdown();
    }, 150);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setValue(q);
    setActiveIndex(-1);
    setIsDropdownOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (q.trim()) {
        navigate(`/search?q=${encodeURIComponent(q.trim())}`, { replace: true });
      }
    }, DEBOUNCE_MS);
  };

  const handleClear = () => {
    setValue("");
    setActiveIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    inputRef.current?.focus();
    navigate("/", { replace: true });
  };

  const itemCount = getDropdownItemCount(recentSearches, suggestions, value);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (isDropdownOpen) {
        closeDropdown();
        e.preventDefault();
      } else {
        handleClear();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isDropdownOpen) {
        setIsDropdownOpen(true);
        loadRecents();
      }
      setActiveIndex((prev) => (prev + 1) % itemCount);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isDropdownOpen) {
        setIsDropdownOpen(true);
        loadRecents();
      }
      setActiveIndex((prev) => (prev <= 0 ? itemCount - 1 : prev - 1));
      return;
    }

    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (activeIndex >= 0 && isDropdownOpen) {
        e.preventDefault();
        // Determine what's at this index
        const trimmed = value.trim();
        const filteredRecents = trimmed
          ? recentSearches.filter((s) =>
              s.toLowerCase().includes(trimmed.toLowerCase())
            )
          : recentSearches;

        if (activeIndex < filteredRecents.length) {
          navigateToSearch(filteredRecents[activeIndex]);
        } else if (activeIndex < filteredRecents.length + suggestions.length) {
          navigateToItem(suggestions[activeIndex - filteredRecents.length]);
        } else {
          // "Search all" item
          navigateToSearch(trimmed);
        }
      } else {
        const q = value.trim();
        if (q) {
          navigateToSearch(q);
        }
      }
    }
  };

  const handleSelectRecent = (term: string) => {
    setValue(term);
    navigateToSearch(term);
  };

  const handleRemoveRecent = async (term: string) => {
    const updated = await removeRecentSearch(term);
    setRecentSearches(updated);
  };

  const handleSelectSuggestion = (suggestion: SearchSuggestion) => {
    navigateToItem(suggestion);
  };

  const handleSearchAll = (q: string) => {
    navigateToSearch(q);
  };

  const bp = useBreakpoint();
  const mobile = isMobile(bp);

  const activeOptionId =
    activeIndex >= 0 ? `search-option-${activeIndex}` : undefined;

  return (
    <div
      role="search"
      style={{
        ...styles.container,
        ...(mobile ? { margin: "0 0.5rem", maxWidth: "none" } : {}),
      }}
    >
      {/* Magnifying glass icon */}
      <svg
        aria-hidden="true"
        style={styles.icon}
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx={11} cy={11} r={8} />
        <line x1={21} y1={21} x2={16.65} y2={16.65} />
      </svg>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder="Search movies, shows, episodes..."
        aria-label="Search movies, shows, episodes"
        role="combobox"
        aria-expanded={isDropdownOpen}
        aria-autocomplete="list"
        aria-controls={isDropdownOpen ? DROPDOWN_ID : undefined}
        aria-activedescendant={activeOptionId}
        style={styles.input}
        spellCheck={false}
      />

      {/* Clear button */}
      {value && (
        <button
          onClick={handleClear}
          style={styles.clearButton}
          aria-label="Clear search"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1={18} y1={6} x2={6} y2={18} />
            <line x1={6} y1={6} x2={18} y2={18} />
          </svg>
        </button>
      )}

      {/* Autocomplete dropdown */}
      {isDropdownOpen && (
        <SearchDropdown
          recentSearches={recentSearches}
          suggestions={suggestions}
          isLoading={isLoading}
          activeIndex={activeIndex}
          query={value}
          onSelectRecent={handleSelectRecent}
          onRemoveRecent={handleRemoveRecent}
          onSelectSuggestion={handleSelectSuggestion}
          onSearchAll={handleSearchAll}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    maxWidth: "400px",
    margin: "0 1.5rem",
    background: "var(--bg-primary)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    padding: "0 0.5rem",
    height: "34px",
    position: "relative",
  },
  icon: {
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    padding: "0 0.5rem",
    height: "100%",
  },
  clearButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    color: "var(--text-secondary)",
    padding: "2px",
    borderRadius: "4px",
    flexShrink: 0,
  },
};

export default SearchBar;
