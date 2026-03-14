/**
 * Modal dialog for submitting a content request.
 * Supports TMDb search (movie/TV) and direct IMDb ID lookup.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { useAuth } from "../hooks/useAuth";
import { useContentRequests } from "../hooks/useContentRequests";
import {
  searchTmdbMovies,
  searchTmdbTvShows,
  findByImdbId,
  getTmdbImageUrl,
  isValidImdbId,
  validateTmdbApiKey,
} from "../services/tmdb";
import { discoverServers } from "../services/plex-api";
import { getTmdbApiKey } from "../services/storage";
import type { PlexServer } from "../types/plex";
import type {
  TmdbMovie,
  TmdbTvShow,
  TmdbSearchResult,
  RequestMediaType,
} from "../types/content-request";

interface ContentRequestFormProps {
  onClose: () => void;
  initialQuery?: string;
  initialMediaType?: "movie" | "tv";
}

type SearchMode = "search" | "imdb";
type MediaTab = "movie" | "tv";

function ContentRequestForm({ onClose, initialQuery, initialMediaType }: ContentRequestFormProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const { authToken } = useAuth();
  const { submitRequest } = useContentRequests();

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(true);
  const [servers, setServers] = useState<PlexServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [searchMode, setSearchMode] = useState<SearchMode>("search");
  const [mediaTab, setMediaTab] = useState<MediaTab>(initialMediaType ?? "movie");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [imdbInput, setImdbInput] = useState("");
  const [results, setResults] = useState<(TmdbMovie | TmdbTvShow)[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TmdbSearchResult | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchVersionRef = useRef(0);

  // Load TMDb API key and available servers on mount
  useEffect(() => {
    (async () => {
      const key = await getTmdbApiKey();
      if (key) {
        const valid = await validateTmdbApiKey(key);
        setApiKey(valid ? key : null);
      }
      setApiKeyLoading(false);
    })();

    // Fetch all servers the user has access to
    if (authToken) {
      (async () => {
        try {
          const allServers = await discoverServers(authToken);
          const online = allServers.filter((s) => s.status === "online");
          setServers(online);
          if (online.length === 1) {
            setSelectedServerId(online[0].clientIdentifier);
          }
        } catch {
          // Non-critical — just won't show server picker
        }
      })();
    }
  }, [authToken]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Debounced TMDb search
  useEffect(() => {
    if (searchMode !== "search" || !apiKey || query.trim().length < 2) {
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const version = ++searchVersionRef.current;
      setIsSearching(true);
      setSearchError(null);

      try {
        const { results: data } =
          mediaTab === "movie"
            ? await searchTmdbMovies(apiKey, query.trim())
            : await searchTmdbTvShows(apiKey, query.trim());

        if (version === searchVersionRef.current) {
          setResults(data);
        }
      } catch (err) {
        if (version === searchVersionRef.current) {
          setSearchError(
            err instanceof Error ? err.message : "Search failed",
          );
        }
      } finally {
        if (version === searchVersionRef.current) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mediaTab, searchMode, apiKey]);

  const handleImdbLookup = useCallback(async () => {
    if (!apiKey || !isValidImdbId(imdbInput.trim())) return;

    setIsSearching(true);
    setSearchError(null);
    setResults([]);

    try {
      const result = await findByImdbId(apiKey, imdbInput.trim());
      if (result) {
        setSelected(result);
      } else {
        setSearchError("No results found for this IMDb ID");
      }
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Lookup failed",
      );
    } finally {
      setIsSearching(false);
    }
  }, [apiKey, imdbInput]);

  const handleSelectResult = useCallback(
    (item: TmdbMovie | TmdbTvShow) => {
      if ("title" in item) {
        setSelected({ ...item, media_type: "movie" });
      } else {
        setSelected({ ...item, media_type: "tv" });
      }
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    if (!selected) return;

    const isMovie = selected.media_type === "movie";
    const title = isMovie
      ? (selected as TmdbMovie).title
      : (selected as TmdbTvShow).name;
    const year = isMovie
      ? (selected as TmdbMovie).release_date?.split("-")[0] ?? ""
      : (selected as TmdbTvShow).first_air_date?.split("-")[0] ?? "";

    const targetServer = servers.find(
      (s) => s.clientIdentifier === selectedServerId
    );

    submitRequest({
      tmdbId: selected.id,
      imdbId: imdbInput.trim() || undefined,
      mediaType: selected.media_type as RequestMediaType,
      title,
      year,
      posterPath: selected.poster_path,
      overview: selected.overview,
      targetServerName: targetServer?.name,
      targetServerId: targetServer?.clientIdentifier,
    });

    setSubmitted(true);
  }, [selected, imdbInput, submitRequest, servers, selectedServerId]);

  // ── Render ──

  if (apiKeyLoading) {
    return (
      <div style={styles.backdrop} onClick={onClose}>
        <div ref={panelRef} style={{ ...styles.panel, ...(mobile ? styles.panelMobile : {}) }} onClick={(e) => e.stopPropagation()}>
          <p style={styles.loadingText}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div style={styles.backdrop} onClick={onClose}>
        <div ref={panelRef} style={{ ...styles.panel, ...(mobile ? styles.panelMobile : {}) }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Content request">
          <h2 style={styles.title}>TMDb API Key Required</h2>
          <p style={styles.description}>
            To search for movies and TV shows, a TMDb API key needs to be
            configured in Settings. Ask a server admin to set it up, or
            visit Settings → Content Requests to add your key.
          </p>
          <button onClick={onClose} style={styles.closeButton}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (submitted) {
    const targetServer = servers.find(
      (s) => s.clientIdentifier === selectedServerId
    );
    return (
      <div style={styles.backdrop} onClick={onClose}>
        <div ref={panelRef} style={{ ...styles.panel, ...(mobile ? styles.panelMobile : {}) }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Request submitted">
          <h2 style={styles.title}>Request Submitted!</h2>
          <p style={styles.description}>
            Your request has been sent
            {targetServer ? ` to the admin of ${targetServer.name}` : ""}.
            You can track its status on the Requests page.
          </p>
          <button onClick={onClose} style={styles.submitButton}>
            Done
          </button>
        </div>
      </div>
    );
  }

  // Selected item confirmation
  if (selected) {
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
          {/* Server picker — shown when user has access to multiple servers */}
          {servers.length > 1 && (
            <div style={styles.serverPickerRow}>
              <label style={styles.serverPickerLabel}>Send request to:</label>
              <select
                value={selectedServerId}
                onChange={(e) => setSelectedServerId(e.target.value)}
                style={styles.serverSelect}
              >
                <option value="">Select a server...</option>
                {servers.map((s) => (
                  <option key={s.clientIdentifier} value={s.clientIdentifier}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={styles.buttonRow}>
            <button
              onClick={() => setSelected(null)}
              style={styles.backButton}
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={servers.length > 1 && !selectedServerId}
              style={{
                ...styles.submitButton,
                ...(servers.length > 1 && !selectedServerId ? styles.buttonDisabled : {}),
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
            onClick={() => { setSearchMode("search"); setResults([]); setSearchError(null); }}
            style={{
              ...styles.tab,
              ...(searchMode === "search" ? styles.tabActive : {}),
            }}
          >
            Search
          </button>
          <button
            onClick={() => { setSearchMode("imdb"); setResults([]); setSearchError(null); }}
            style={{
              ...styles.tab,
              ...(searchMode === "imdb" ? styles.tabActive : {}),
            }}
          >
            IMDb ID
          </button>
        </div>

        {searchMode === "search" ? (
          <>
            {/* Media type toggle */}
            <div style={styles.tabRow}>
              <button
                onClick={() => { setMediaTab("movie"); setResults([]); }}
                style={{
                  ...styles.miniTab,
                  ...(mediaTab === "movie" ? styles.miniTabActive : {}),
                }}
              >
                Movies
              </button>
              <button
                onClick={() => { setMediaTab("tv"); setResults([]); }}
                style={{
                  ...styles.miniTab,
                  ...(mediaTab === "tv" ? styles.miniTabActive : {}),
                }}
              >
                TV Shows
              </button>
            </div>

            {/* Search input */}
            <input
              type="text"
              placeholder={`Search ${mediaTab === "movie" ? "movies" : "TV shows"}...`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={styles.input}
              autoFocus
            />

            {/* Results */}
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
                    onClick={() => handleSelectResult(item)}
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
          </>
        ) : (
          <>
            {/* IMDb ID input */}
            <div style={styles.imdbRow}>
              <input
                type="text"
                placeholder="tt1234567"
                value={imdbInput}
                onChange={(e) => setImdbInput(e.target.value)}
                style={{ ...styles.input, flex: 1 }}
                autoFocus
              />
              <button
                onClick={handleImdbLookup}
                disabled={!isValidImdbId(imdbInput.trim()) || isSearching}
                style={{
                  ...styles.submitButton,
                  ...((!isValidImdbId(imdbInput.trim()) || isSearching)
                    ? styles.buttonDisabled
                    : {}),
                }}
              >
                {isSearching ? "Looking up..." : "Look up"}
              </button>
            </div>
            <p style={styles.hintText}>
              Enter an IMDb ID (e.g., tt1234567) to look up the exact title.
            </p>
            {searchError && <p style={styles.errorText}>{searchError}</p>}
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
  emptyText: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    textAlign: "center",
    padding: "1rem 0",
    margin: 0,
  },
};

export default ContentRequestForm;
