/**
 * Modal dialog for fixing/adding metadata matches on library items.
 * Admin-only — uses the Plex match API with title or IMDb ID search.
 */

import { useState, useRef, useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useFixMatch } from "../hooks/useFixMatch";
import { isValidImdbId } from "../services/tmdb";
import type { PlexSearchResult } from "../types/fix-match";

interface FixMatchDialogProps {
  ratingKey: string;
  currentTitle: string;
  currentYear?: string;
  mediaType: string; // "movie" | "show" | "episode"
  onClose: () => void;
  onMatchApplied?: () => void;
}

function FixMatchDialog({
  ratingKey,
  currentTitle,
  currentYear,
  mediaType,
  onClose,
  onMatchApplied,
}: FixMatchDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  const fixMatch = useFixMatch(ratingKey);

  const [titleInput, setTitleInput] = useState(currentTitle);
  const [yearInput, setYearInput] = useState(currentYear ?? "");
  const [imdbInput, setImdbInput] = useState("");
  const [useImdb, setUseImdb] = useState(false);
  const [success, setSuccess] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSearch = async () => {
    if (useImdb) {
      if (isValidImdbId(imdbInput.trim())) {
        await fixMatch.searchByImdb(imdbInput.trim(), mediaType);
      }
    } else {
      if (titleInput.trim()) {
        await fixMatch.search(
          titleInput.trim(),
          yearInput.trim() || undefined,
          mediaType,
        );
      }
    }
  };

  const handleApply = async (result: PlexSearchResult) => {
    const ok = await fixMatch.applyMatch(result.guid, result.name, result.year);
    if (ok) {
      setSuccess(true);
      onMatchApplied?.();
      // Auto-close after brief success message
      setTimeout(onClose, 1500);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  if (success) {
    return (
      <div style={styles.backdrop} onClick={onClose}>
        <div ref={panelRef} style={styles.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Match applied">
          <div style={styles.successMessage}>
            <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <p style={styles.successText}>Match applied! Refreshing metadata...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div ref={panelRef} style={styles.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Fix match">
        <h2 style={styles.title}>Fix Match</h2>

        {/* Toggle between title search and IMDb ID */}
        <div style={styles.toggleRow}>
          <button
            onClick={() => { setUseImdb(false); fixMatch.reset(); }}
            style={{
              ...styles.toggle,
              ...(!useImdb ? styles.toggleActive : {}),
            }}
          >
            Search by Title
          </button>
          <button
            onClick={() => { setUseImdb(true); fixMatch.reset(); }}
            style={{
              ...styles.toggle,
              ...(useImdb ? styles.toggleActive : {}),
            }}
          >
            IMDb ID
          </button>
        </div>

        {/* Search inputs */}
        {useImdb ? (
          <div style={styles.inputRow}>
            <input
              type="text"
              placeholder="tt1234567"
              value={imdbInput}
              onChange={(e) => setImdbInput(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{ ...styles.input, flex: 1 }}
              autoFocus
            />
            <button
              onClick={handleSearch}
              disabled={!isValidImdbId(imdbInput.trim()) || fixMatch.isSearching}
              style={{
                ...styles.searchButton,
                ...((!isValidImdbId(imdbInput.trim()) || fixMatch.isSearching) ? styles.buttonDisabled : {}),
              }}
            >
              Search
            </button>
          </div>
        ) : (
          <div style={styles.inputGroup}>
            <div style={styles.inputRow}>
              <input
                type="text"
                placeholder="Title"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{ ...styles.input, flex: 1 }}
                autoFocus
              />
              <input
                type="text"
                placeholder="Year"
                value={yearInput}
                onChange={(e) => setYearInput(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{ ...styles.input, width: "70px" }}
              />
              <button
                onClick={handleSearch}
                disabled={!titleInput.trim() || fixMatch.isSearching}
                style={{
                  ...styles.searchButton,
                  ...((!titleInput.trim() || fixMatch.isSearching) ? styles.buttonDisabled : {}),
                }}
              >
                Search
              </button>
            </div>
          </div>
        )}

        {/* Status messages */}
        {fixMatch.isSearching && (
          <p style={styles.statusText}>Searching...</p>
        )}
        {fixMatch.searchError && (
          <p style={styles.errorText}>{fixMatch.searchError}</p>
        )}
        {fixMatch.applyError && (
          <p style={styles.errorText}>{fixMatch.applyError}</p>
        )}

        {/* Results */}
        {fixMatch.searchResults.length > 0 && (
          <div style={styles.resultsList}>
            {fixMatch.searchResults.map((result, i) => (
              <div key={result.guid || i} style={styles.resultItem}>
                <div style={styles.resultInfo}>
                  <span style={styles.resultTitle}>{result.name}</span>
                  <span style={styles.resultMeta}>
                    {result.year || "Unknown year"}
                    {" · "}
                    Match: {Math.round(result.score * 100)}%
                  </span>
                  {result.summary && (
                    <span style={styles.resultSummary}>
                      {result.summary.length > 120
                        ? result.summary.slice(0, 120) + "..."
                        : result.summary}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleApply(result)}
                  disabled={fixMatch.isApplying}
                  style={{
                    ...styles.applyButton,
                    ...(fixMatch.isApplying ? styles.buttonDisabled : {}),
                  }}
                >
                  {fixMatch.isApplying ? "..." : "Apply"}
                </button>
              </div>
            ))}
          </div>
        )}

        {!fixMatch.isSearching &&
          fixMatch.searchResults.length === 0 &&
          !fixMatch.searchError && (
            <p style={styles.hintText}>
              Search for the correct title or enter an IMDb ID to find a match.
            </p>
          )}

        <button onClick={onClose} style={styles.cancelButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
  },
  panel: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    padding: "1.5rem",
    width: "100%",
    maxWidth: "520px",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
  },
  title: {
    fontSize: "1.1rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: 0,
  },
  toggleRow: {
    display: "flex",
    gap: "0.5rem",
  },
  toggle: {
    flex: 1,
    padding: "0.4rem",
    fontSize: "0.8rem",
    fontWeight: 500,
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  toggleActive: {
    background: "var(--accent)",
    color: "#000",
    borderColor: "var(--accent)",
    fontWeight: 600,
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  inputRow: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
  },
  input: {
    padding: "0.5rem 0.75rem",
    fontSize: "0.85rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    outline: "none",
    boxSizing: "border-box",
  },
  searchButton: {
    padding: "0.5rem 0.75rem",
    fontSize: "0.8rem",
    fontWeight: 600,
    borderRadius: "6px",
    background: "var(--accent)",
    color: "#000",
    border: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  resultsList: {
    flex: 1,
    overflowY: "auto",
    maxHeight: "300px",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  resultItem: {
    display: "flex",
    gap: "0.75rem",
    padding: "0.6rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "rgba(255,255,255,0.02)",
    alignItems: "center",
  },
  resultInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.1rem",
    overflow: "hidden",
    flex: 1,
  },
  resultTitle: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  resultMeta: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
  },
  resultSummary: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
    lineHeight: 1.3,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  applyButton: {
    padding: "0.4rem 0.75rem",
    fontSize: "0.75rem",
    fontWeight: 600,
    borderRadius: "4px",
    background: "var(--accent)",
    color: "#000",
    border: "none",
    cursor: "pointer",
    flexShrink: 0,
  },
  statusText: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    textAlign: "center",
    margin: 0,
  },
  errorText: {
    fontSize: "0.8rem",
    color: "var(--error)",
    margin: 0,
  },
  hintText: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    textAlign: "center",
    padding: "1rem 0",
    margin: 0,
    opacity: 0.7,
  },
  cancelButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.75rem",
    padding: "0.25rem",
    alignSelf: "center",
    cursor: "pointer",
    border: "none",
  },
  successMessage: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.75rem",
    padding: "2rem 1rem",
  },
  successText: {
    fontSize: "0.95rem",
    fontWeight: 500,
    color: "var(--text-primary)",
    margin: 0,
  },
};

export default FixMatchDialog;
