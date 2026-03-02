import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const DEBOUNCE_MS = 300;

function SearchBar() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync input when navigating away from search page
  useEffect(() => {
    const q = searchParams.get("q") ?? "";
    setValue(q);
  }, [searchParams]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setValue(q);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (q.trim()) {
        navigate(`/search?q=${encodeURIComponent(q.trim())}`, { replace: true });
      }
    }, DEBOUNCE_MS);
  };

  const handleClear = () => {
    setValue("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    inputRef.current?.focus();
    navigate("/", { replace: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      handleClear();
    }
    if (e.key === "Enter") {
      // Navigate immediately on Enter
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const q = value.trim();
      if (q) {
        navigate(`/search?q=${encodeURIComponent(q)}`, { replace: true });
      }
    }
  };

  return (
    <div style={styles.container}>
      {/* Magnifying glass icon */}
      <svg
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
        placeholder="Search movies, shows, episodes..."
        style={styles.input}
        spellCheck={false}
      />

      {/* Clear button */}
      {value && (
        <button onClick={handleClear} style={styles.clearButton} aria-label="Clear search">
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
