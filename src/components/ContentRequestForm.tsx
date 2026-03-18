/**
 * Modal dialog for submitting a content request.
 * Supports TMDb search (movie/TV) and direct IMDb ID lookup.
 */

import { useRef, useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { useTmdbSearch } from "../hooks/useTmdbSearch";
import { useRequestSubmission } from "../hooks/useRequestSubmission";
import { getTmdbImageUrl, isValidImdbId } from "../services/tmdb";
import TmdbSearchResults from "./requests/TmdbSearchResults";
import RequestSubmittedState from "./requests/RequestSubmittedState";
import type { TmdbMovie, TmdbTvShow } from "../types/content-request";

interface ContentRequestFormProps {
  onClose: () => void;
  initialQuery?: string;
  initialMediaType?: "movie" | "tv";
}

function ContentRequestForm({ onClose, initialQuery, initialMediaType }: ContentRequestFormProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  const bp = useBreakpoint();
  const mobile = isMobile(bp);

  const search = useTmdbSearch({ initialQuery, initialMediaType });
  const submission = useRequestSubmission();

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSelectResult = (item: TmdbMovie | TmdbTvShow) => {
    const result = search.handleSelectResult(item);
    submission.setSelected(result);
  };

  const handleImdbLookup = async () => {
    const result = await search.handleImdbLookup();
    if (result) {
      submission.setSelected(result);
    }
  };

  const handleSubmit = () => {
    submission.handleSubmit(search.imdbInput);
  };

  // ── Render ──

  if (search.tmdbLoading) {
    return (
      <div style={styles.backdrop} onClick={onClose}>
        <div ref={panelRef} style={{ ...styles.panel, ...(mobile ? styles.panelMobile : {}) }} onClick={(e) => e.stopPropagation()}>
          <p style={styles.loadingText}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!search.tmdbReady) {
    return (
      <div style={styles.backdrop} onClick={onClose}>
        <div ref={panelRef} style={{ ...styles.panel, ...(mobile ? styles.panelMobile : {}) }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Content request">
          <h2 style={styles.title}>TMDb Search Unavailable</h2>
          <p style={styles.description}>
            The relay server does not have a TMDb API key configured.
            Ask the server admin to set the TMDB_API_KEY environment
            variable on the relay server.
          </p>
          <button onClick={onClose} style={styles.closeButton}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (submission.submitted) {
    return (
      <RequestSubmittedState
        onClose={onClose}
        targetServerName={submission.targetServer?.name}
      />
    );
  }

  // Selected item confirmation
  if (submission.selected) {
    const { selected } = submission;
    const isMovie = selected.media_type === "movie";
    const title = isMovie
      ? (selected as TmdbMovie).title
      : (selected as TmdbTvShow).name;
    const year = isMovie
      ? (selected as TmdbMovie).release_date?.split("-")[0]
      : (selected as TmdbTvShow).first_air_date?.split("-")[0];
    const posterUrl = getTmdbImageUrl(selected.poster_path, "w185");

    return (
      <div style={styles.backdrop} onClick={onClose}>
        <div ref={panelRef} style={{ ...styles.panel, ...(mobile ? styles.panelMobile : {}) }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Confirm request">
          <h2 style={styles.title}>Confirm Request</h2>
          <div style={styles.selectedCard}>
            {posterUrl && (
              <img
                src={posterUrl}
                alt=""
                style={styles.selectedPoster}
              />
            )}
            <div style={styles.selectedInfo}>
              <strong style={styles.selectedTitle}>{title}</strong>
              <span style={styles.selectedMeta}>
                {year} · {isMovie ? "Movie" : "TV Show"}
              </span>
              {selected.overview && (
                <p style={styles.selectedOverview}>
                  {selected.overview.length > 200
                    ? selected.overview.slice(0, 200) + "..."
                    : selected.overview}
                </p>
              )}
            </div>
          </div>
          {/* Server picker -- shown when user has access to multiple servers */}
          {submission.servers.length > 1 && (
            <div style={styles.serverPickerRow}>
              <label style={styles.serverPickerLabel}>Send request to:</label>
              <select
                value={submission.selectedServerId}
                onChange={(e) => submission.setSelectedServerId(e.target.value)}
                style={styles.serverSelect}
              >
                <option value="">Select a server...</option>
                {submission.servers.map((s) => (
                  <option key={s.clientIdentifier} value={s.clientIdentifier}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={styles.buttonRow}>
            <button
              onClick={() => submission.setSelected(null)}
              style={styles.backButton}
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={submission.servers.length > 1 && !submission.selectedServerId}
              style={{
                ...styles.submitButton,
                ...(submission.servers.length > 1 && !submission.selectedServerId ? styles.buttonDisabled : {}),
              }}
            >
              Submit Request
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div ref={panelRef} style={{ ...styles.panel, ...(mobile ? styles.panelMobile : {}) }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Request content">
        <h2 style={styles.title}>Request Content</h2>

        {/* Mode toggle */}
        <div style={styles.tabRow}>
          <button
            onClick={() => { search.setSearchMode("search"); search.clearResults(); search.clearError(); }}
            style={{
              ...styles.tab,
              ...(search.searchMode === "search" ? styles.tabActive : {}),
            }}
          >
            Search
          </button>
          <button
            onClick={() => { search.setSearchMode("imdb"); search.clearResults(); search.clearError(); }}
            style={{
              ...styles.tab,
              ...(search.searchMode === "imdb" ? styles.tabActive : {}),
            }}
          >
            IMDb ID
          </button>
        </div>

        {search.searchMode === "search" ? (
          <>
            {/* Media type toggle */}
            <div style={styles.tabRow}>
              <button
                onClick={() => { search.setMediaTab("movie"); search.clearResults(); }}
                style={{
                  ...styles.miniTab,
                  ...(search.mediaTab === "movie" ? styles.miniTabActive : {}),
                }}
              >
                Movies
              </button>
              <button
                onClick={() => { search.setMediaTab("tv"); search.clearResults(); }}
                style={{
                  ...styles.miniTab,
                  ...(search.mediaTab === "tv" ? styles.miniTabActive : {}),
                }}
              >
                TV Shows
              </button>
            </div>

            {/* Search input */}
            <input
              type="text"
              placeholder={`Search ${search.mediaTab === "movie" ? "movies" : "TV shows"}...`}
              value={search.query}
              onChange={(e) => search.setQuery(e.target.value)}
              style={styles.input}
              autoFocus
            />

            {/* Results */}
            <TmdbSearchResults
              results={search.results}
              isSearching={search.isSearching}
              searchError={search.searchError}
              query={search.query}
              onSelect={handleSelectResult}
            />
          </>
        ) : (
          <>
            {/* IMDb ID input */}
            <div style={styles.imdbRow}>
              <input
                type="text"
                placeholder="tt1234567"
                value={search.imdbInput}
                onChange={(e) => search.setImdbInput(e.target.value)}
                style={{ ...styles.input, flex: 1 }}
                autoFocus
              />
              <button
                onClick={handleImdbLookup}
                disabled={!isValidImdbId(search.imdbInput.trim()) || search.isSearching}
                style={{
                  ...styles.submitButton,
                  ...((!isValidImdbId(search.imdbInput.trim()) || search.isSearching)
                    ? styles.buttonDisabled
                    : {}),
                }}
              >
                {search.isSearching ? "Looking up..." : "Look up"}
              </button>
            </div>
            <p style={styles.hintText}>
              Enter an IMDb ID (e.g., tt1234567) to look up the exact title.
            </p>
            {search.searchError && <p style={styles.errorText}>{search.searchError}</p>}
          </>
        )}

        <button onClick={onClose} style={styles.cancelLink}>
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
    maxWidth: "480px",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
  },
  panelMobile: {
    maxWidth: "100%",
    maxHeight: "90vh",
    borderRadius: "8px",
  },
  title: {
    fontSize: "1.1rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: 0,
  },
  description: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    margin: 0,
  },
  tabRow: {
    display: "flex",
    gap: "0.5rem",
  },
  tab: {
    flex: 1,
    padding: "0.5rem",
    fontSize: "0.8rem",
    fontWeight: 500,
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  tabActive: {
    background: "var(--accent)",
    color: "#000",
    borderColor: "var(--accent)",
    fontWeight: 600,
  },
  miniTab: {
    padding: "0.3rem 0.75rem",
    fontSize: "0.75rem",
    fontWeight: 500,
    borderRadius: "4px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  miniTabActive: {
    background: "rgba(229,160,13,0.15)",
    color: "var(--accent)",
    borderColor: "var(--accent)",
  },
  input: {
    width: "100%",
    padding: "0.6rem 0.75rem",
    fontSize: "0.85rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    outline: "none",
    boxSizing: "border-box",
  },
  imdbRow: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
  },
  hintText: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
    margin: 0,
    opacity: 0.7,
  },
  selectedCard: {
    display: "flex",
    gap: "0.75rem",
    padding: "0.75rem",
    background: "rgba(255,255,255,0.03)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
  },
  selectedPoster: {
    width: "80px",
    height: "120px",
    borderRadius: "4px",
    objectFit: "cover",
    flexShrink: 0,
  },
  selectedInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    overflow: "hidden",
    flex: 1,
  },
  selectedTitle: {
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  selectedMeta: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  selectedOverview: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
    lineHeight: 1.4,
    margin: 0,
  },
  buttonRow: {
    display: "flex",
    gap: "0.5rem",
    justifyContent: "flex-end",
  },
  submitButton: {
    padding: "0.5rem 1rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    borderRadius: "6px",
    background: "var(--accent)",
    color: "#000",
    border: "none",
    cursor: "pointer",
  },
  backButton: {
    padding: "0.5rem 1rem",
    fontSize: "0.85rem",
    borderRadius: "6px",
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    cursor: "pointer",
  },
  closeButton: {
    padding: "0.5rem 1rem",
    fontSize: "0.85rem",
    borderRadius: "6px",
    background: "rgba(255,255,255,0.1)",
    color: "var(--text-primary)",
    border: "1px solid var(--border)",
    cursor: "pointer",
    alignSelf: "flex-end",
  },
  cancelLink: {
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.75rem",
    padding: "0.25rem",
    alignSelf: "center",
    cursor: "pointer",
    border: "none",
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  serverPickerRow: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  },
  serverPickerLabel: {
    fontSize: "0.8rem",
    fontWeight: 500,
    color: "var(--text-secondary)",
  },
  serverSelect: {
    width: "100%",
    padding: "0.5rem 0.75rem",
    fontSize: "0.85rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    outline: "none",
    boxSizing: "border-box",
    cursor: "pointer",
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
};

export default ContentRequestForm;
