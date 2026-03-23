import { useState, useEffect, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import {
  getPlaylists,
  addToPlaylist,
  createPlaylist,
} from "../services/plex-library";
import { cacheInvalidate } from "../services/api-cache";
import type { PlexPlaylist } from "../types/library";

interface PlaylistPickerProps {
  ratingKey: string;
  title: string;
  onClose: () => void;
  onSuccess?: () => void;
}

function PlaylistPicker({
  ratingKey,
  title,
  onClose,
  onSuccess,
}: PlaylistPickerProps) {
  const { server } = useAuth();
  const { toast } = useToast();
  const [playlists, setPlaylists] = useState<PlexPlaylist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);

  // Fetch playlists on mount
  useEffect(() => {
    if (!server) return;
    let cancelled = false;

    (async () => {
      try {
        const list = await getPlaylists(server.uri, server.accessToken);
        if (!cancelled) setPlaylists(list);
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load playlists"
          );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleAdd = async (playlist: PlexPlaylist) => {
    if (!server) return;
    setAdding(playlist.ratingKey);
    setError(null);

    try {
      await addToPlaylist(
        server.uri,
        server.accessToken,
        playlist.ratingKey,
        ratingKey,
        server.clientIdentifier
      );
      cacheInvalidate("playlists:all");
      toast(`Added to "${playlist.title}"`, "success");
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to add to playlist"
      );
      setAdding(null);
    }
  };

  const handleCreate = async () => {
    if (!server || !newPlaylistName.trim()) return;
    setIsCreating(true);
    setError(null);

    try {
      await createPlaylist(
        server.uri,
        server.accessToken,
        newPlaylistName.trim(),
        ratingKey,
        server.clientIdentifier
      );
      cacheInvalidate("playlists:all");
      toast(`Added to "${newPlaylistName.trim()}"`, "success");
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create playlist"
      );
      setIsCreating(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-picker-title"
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={styles.header}>
          <h2 id="playlist-picker-title" style={styles.heading}>
            Add to Playlist
          </h2>
          <button onClick={onClose} style={styles.closeButton} aria-label="Close">
            ✕
          </button>
        </div>
        <p style={styles.subtitle}>{title}</p>

        {/* Playlist list */}
        <div style={styles.list}>
            {isLoading && (
              <p style={styles.loadingText}>Loading playlists...</p>
            )}
            {!isLoading && playlists.length === 0 && (
              <p style={styles.loadingText}>No playlists yet</p>
            )}
            {playlists.map((pl) => (
              <button
                key={pl.ratingKey}
                style={{
                  ...styles.playlistRow,
                  opacity: adding && adding !== pl.ratingKey ? 0.5 : 1,
                }}
                onClick={() => handleAdd(pl)}
                disabled={!!adding}
              >
                <svg
                  width={18}
                  height={18}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  style={{ flexShrink: 0 }}
                >
                  <line x1={8} y1={6} x2={21} y2={6} />
                  <line x1={8} y1={12} x2={21} y2={12} />
                  <line x1={8} y1={18} x2={21} y2={18} />
                  <line x1={3} y1={6} x2={3.01} y2={6} />
                  <line x1={3} y1={12} x2={3.01} y2={12} />
                  <line x1={3} y1={18} x2={3.01} y2={18} />
                </svg>
                <div style={styles.playlistInfo}>
                  <span style={styles.playlistTitle}>{pl.title}</span>
                  <span style={styles.playlistCount}>
                    {pl.leafCount ?? 0} item{(pl.leafCount ?? 0) !== 1 ? "s" : ""}
                  </span>
                </div>
                {adding === pl.ratingKey && (
                  <span style={styles.addingText}>Adding...</span>
                )}
              </button>
            ))}
          </div>

        {/* Create new playlist */}
        <div style={styles.createSection}>
            <div style={styles.createRow}>
              <input
                type="text"
                placeholder="New playlist name..."
                aria-label="New playlist name"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                style={styles.createInput}
                disabled={!!adding || isCreating}
              />
              <button
                onClick={handleCreate}
                disabled={!newPlaylistName.trim() || !!adding || isCreating}
                style={{
                  ...styles.createButton,
                  opacity:
                    !newPlaylistName.trim() || !!adding || isCreating ? 0.5 : 1,
                }}
              >
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>

        {/* Error */}
        {error && <p style={styles.errorText}>{error}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    animation: "overlayFadeIn 0.2s ease-out",
  },
  modal: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    width: "400px",
    maxHeight: "70vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    animation: "modalSlideUp 0.25s ease-out",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1rem 1.25rem 0",
  },
  heading: {
    fontSize: "1.1rem",
    fontWeight: 700,
    margin: 0,
  },
  closeButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "1.1rem",
    border: "none",
    cursor: "pointer",
    padding: "0.25rem",
  },
  subtitle: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    margin: "0.25rem 1.25rem 0.75rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "0 0.5rem",
    maxHeight: "300px",
  },
  loadingText: {
    textAlign: "center",
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    padding: "2rem",
  },
  playlistRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    width: "100%",
    padding: "0.6rem 0.75rem",
    borderRadius: "8px",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-primary)",
    transition: "background 0.15s",
    textAlign: "left",
  },
  playlistInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  playlistTitle: {
    fontSize: "0.9rem",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  playlistCount: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  addingText: {
    fontSize: "0.8rem",
    color: "var(--accent)",
    flexShrink: 0,
  },
  createSection: {
    padding: "0.75rem 1.25rem",
    borderTop: "1px solid var(--border)",
  },
  createRow: {
    display: "flex",
    gap: "0.5rem",
  },
  createInput: {
    flex: 1,
    padding: "0.45rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    outline: "none",
  },
  createButton: {
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "6px",
    padding: "0.45rem 0.75rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
  },
  errorText: {
    color: "var(--error)",
    fontSize: "0.85rem",
    padding: "0 1.25rem 0.75rem",
    margin: 0,
  },
};

export default PlaylistPicker;
