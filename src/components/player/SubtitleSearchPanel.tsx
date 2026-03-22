import { useState, useCallback, useEffect, useRef } from "react";
import { LANGUAGES } from "../../constants/languages";
import { searchSubtitles, downloadSubtitle } from "../../services/subtitle-search";
import { filterSubtitleTracks } from "../../utils/subtitle-filter";
import type { PlexStream } from "../../types/library";
import type { ExternalSubtitle } from "../../types/subtitles";

interface SubtitleSearchPanelProps {
  serverUri: string;
  serverToken: string;
  ratingKey: string;
  subtitleTracks: PlexStream[];
  onSelectTrack: (streamId: number | null) => void;
  selectedSubtitleId: number | null;
  onSubtitleDownloaded: () => void;
  onClose: () => void;
}

type Tab = "embedded" | "search";

export default function SubtitleSearchPanel({
  serverUri,
  serverToken,
  ratingKey,
  subtitleTracks,
  onSelectTrack,
  selectedSubtitleId,
  onSubtitleDownloaded,
  onClose,
}: SubtitleSearchPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("embedded");
  const panelRef = useRef<HTMLDivElement>(null);

  // Embedded tab state
  const [filterQuery, setFilterQuery] = useState("");
  const [filterLang, setFilterLang] = useState("");
  const [filterHI, setFilterHI] = useState<boolean | undefined>(undefined);

  // Search tab state
  const [searchLang, setSearchLang] = useState("en");
  const [searchResults, setSearchResults] = useState<ExternalSubtitle[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const filteredEmbedded = filterSubtitleTracks(
    subtitleTracks,
    filterQuery || undefined,
    filterLang || undefined,
    filterHI,
  );

  const handleSearch = useCallback(async () => {
    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const results = await searchSubtitles(serverUri, serverToken, ratingKey, searchLang);
      setSearchResults(results);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  }, [serverUri, serverToken, ratingKey, searchLang]);

  const handleDownload = useCallback(async (sub: ExternalSubtitle) => {
    setDownloadingId(sub.id);
    setDownloadSuccess(null);
    try {
      await downloadSubtitle(serverUri, serverToken, ratingKey, sub.key);
      setDownloadSuccess(sub.id);
      onSubtitleDownloaded();
    } catch {
      setSearchError("Download failed. Try again.");
    } finally {
      setDownloadingId(null);
    }
  }, [serverUri, serverToken, ratingKey, onSubtitleDownloaded]);

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div ref={panelRef} style={styles.panel} role="dialog" aria-label="Subtitle search">
        <div style={styles.header}>
          <h3 style={styles.title}>Subtitles</h3>
          <button onClick={onClose} style={styles.closeButton} aria-label="Close">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1={18} y1={6} x2={6} y2={18} />
              <line x1={6} y1={6} x2={18} y2={18} />
            </svg>
          </button>
        </div>

        {/* Tab switcher */}
        <div style={styles.tabs}>
          <button
            onClick={() => setActiveTab("embedded")}
            style={{
              ...styles.tab,
              ...(activeTab === "embedded" ? styles.tabActive : {}),
            }}
          >
            Embedded ({subtitleTracks.length})
          </button>
          <button
            onClick={() => setActiveTab("search")}
            style={{
              ...styles.tab,
              ...(activeTab === "search" ? styles.tabActive : {}),
            }}
          >
            Search Online
          </button>
        </div>

        <div style={styles.content}>
          {activeTab === "embedded" ? (
            <>
              {/* Filter controls */}
              <div style={styles.filterRow}>
                <input
                  type="text"
                  placeholder="Filter tracks..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  style={styles.filterInput}
                />
                <select
                  value={filterLang}
                  onChange={(e) => setFilterLang(e.target.value)}
                  style={styles.filterSelect}
                >
                  <option value="">All Languages</option>
                  {LANGUAGES.filter((l) => l.code).map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
              </div>
              <div style={styles.filterRow}>
                <label style={styles.hiToggle}>
                  <input
                    type="checkbox"
                    checked={filterHI === true}
                    onChange={(e) => setFilterHI(e.target.checked ? true : undefined)}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  Hearing Impaired only
                </label>
              </div>

              {/* Track list */}
              <div style={styles.trackList} role="listbox">
                <button
                  onClick={() => onSelectTrack(null)}
                  style={{
                    ...styles.trackItem,
                    ...(selectedSubtitleId === null ? styles.trackItemSelected : {}),
                  }}
                  role="option"
                  aria-selected={selectedSubtitleId === null}
                >
                  <span style={styles.trackTitle}>None</span>
                </button>
                {filteredEmbedded.map((track) => (
                  <button
                    key={track.id}
                    onClick={() => onSelectTrack(track.id)}
                    style={{
                      ...styles.trackItem,
                      ...(selectedSubtitleId === track.id ? styles.trackItemSelected : {}),
                    }}
                    role="option"
                    aria-selected={selectedSubtitleId === track.id}
                  >
                    <span style={styles.trackTitle}>{track.displayTitle}</span>
                    <span style={styles.trackMeta}>
                      {track.codec?.toUpperCase()}
                      {track.forced && " \u00b7 Forced"}
                      {track.hearingImpaired && " \u00b7 HI"}
                    </span>
                  </button>
                ))}
                {filteredEmbedded.length === 0 && subtitleTracks.length > 0 && (
                  <div style={styles.emptyState}>No tracks match your filter</div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Search controls */}
              <div style={styles.searchRow}>
                <select
                  value={searchLang}
                  onChange={(e) => setSearchLang(e.target.value)}
                  style={styles.filterSelect}
                >
                  {LANGUAGES.filter((l) => l.code).map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleSearch}
                  disabled={isSearching}
                  style={styles.searchButton}
                >
                  {isSearching ? "Searching..." : "Search"}
                </button>
              </div>

              {searchError && (
                <div style={styles.error}>{searchError}</div>
              )}

              {/* Results list */}
              <div style={styles.trackList}>
                {searchResults.map((sub) => (
                  <div key={sub.id} style={styles.searchResult}>
                    <div style={styles.resultInfo}>
                      <span style={styles.trackTitle}>{sub.fileName}</span>
                      <span style={styles.trackMeta}>
                        {sub.format.toUpperCase()}
                        {sub.hearingImpaired && " \u00b7 HI"}
                        {" \u00b7 "}{Math.round(sub.matchConfidence * 100)}% match
                        {" \u00b7 "}{sub.provider}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDownload(sub)}
                      disabled={downloadingId === sub.id}
                      style={{
                        ...styles.downloadButton,
                        ...(downloadSuccess === sub.id ? styles.downloadSuccess : {}),
                      }}
                    >
                      {downloadSuccess === sub.id
                        ? "\u2713"
                        : downloadingId === sub.id
                          ? "..."
                          : "\u2193"}
                    </button>
                  </div>
                ))}
                {searchResults.length === 0 && !isSearching && !searchError && (
                  <div style={styles.emptyState}>
                    Select a language and click Search to find subtitles
                  </div>
                )}
                {isSearching && (
                  <div style={styles.emptyState}>Searching for subtitles...</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
  },
  panel: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: "380px",
    maxWidth: "90vw",
    background: "rgba(15, 15, 15, 0.95)",
    backdropFilter: "blur(16px)",
    borderLeft: "1px solid rgba(255,255,255,0.1)",
    zIndex: 41,
    display: "flex",
    flexDirection: "column",
    animation: "slideLeft 0.2s ease-out",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1rem 1.25rem",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  title: {
    fontSize: "1rem",
    fontWeight: 600,
    margin: 0,
  },
  closeButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    cursor: "pointer",
    padding: "0.25rem",
    display: "flex",
    alignItems: "center",
  },
  tabs: {
    display: "flex",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  tab: {
    flex: 1,
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    padding: "0.75rem",
    fontSize: "0.85rem",
    fontWeight: 500,
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    transition: "color 0.15s ease, border-color 0.15s ease",
  },
  tabActive: {
    color: "var(--accent)",
    borderBottomColor: "var(--accent)",
  },
  content: {
    flex: 1,
    overflowY: "auto",
    padding: "0.75rem",
  },
  filterRow: {
    display: "flex",
    gap: "0.5rem",
    marginBottom: "0.5rem",
  },
  filterInput: {
    flex: 1,
    padding: "0.4rem 0.6rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    outline: "none",
  },
  filterSelect: {
    padding: "0.4rem 0.6rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    outline: "none",
    minWidth: "100px",
  },
  hiToggle: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  searchRow: {
    display: "flex",
    gap: "0.5rem",
    marginBottom: "0.75rem",
  },
  searchButton: {
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "6px",
    padding: "0.4rem 1rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  trackList: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  trackItem: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
    background: "transparent",
    border: "none",
    color: "var(--text-primary)",
    textAlign: "left",
    cursor: "pointer",
    transition: "background 0.1s ease",
  },
  trackItemSelected: {
    background: "rgba(229, 160, 13, 0.15)",
    borderLeft: "3px solid var(--accent)",
  },
  trackTitle: {
    fontSize: "0.85rem",
    fontWeight: 500,
  },
  trackMeta: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
  },
  searchResult: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
  },
  resultInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    overflow: "hidden",
  },
  downloadButton: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "rgba(255,255,255,0.1)",
    color: "var(--text-primary)",
    border: "none",
    fontSize: "1.1rem",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  downloadSuccess: {
    background: "var(--accent)",
    color: "#000",
  },
  emptyState: {
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    textAlign: "center",
    padding: "1.5rem 1rem",
  },
  error: {
    color: "#f44",
    fontSize: "0.8rem",
    padding: "0.5rem",
    marginBottom: "0.5rem",
    background: "rgba(255, 68, 68, 0.1)",
    borderRadius: "6px",
  },
};
