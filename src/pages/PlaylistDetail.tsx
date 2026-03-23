import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  getPlaylistItems,
  getPlaylists,
  getImageUrl,
  deletePlaylist,
  removeFromPlaylist,
  movePlaylistItem,
  updatePlaylist,
} from "../services/plex-library";
import { cacheInvalidate } from "../services/api-cache";
import { useMediaContextMenu } from "../hooks/useMediaContextMenu";
import { usePlayAction } from "../hooks/usePlayAction";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { useQueue } from "../contexts/QueueContext";
import { buildQueueFromItems, shuffleArray } from "../utils/queue-helpers";
import LibraryGrid from "../components/LibraryGrid";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import { decodeHtmlEntities, isWatched } from "../utils/media-helpers";
import {
  getMediaTitle,
  getMediaSubtitle,
  getMediaPoster,
  getProgress,
} from "../utils/media-helpers";
import type { PlexMediaItem, PlexPlaylist, PlexEpisode } from "../types/library";
import type { ContextMenuItem } from "../components/ContextMenu";

/** A group of episodes from the same show, or a standalone movie */
interface PlaylistGroup {
  type: "show-group" | "movie";
  /** For shows: grandparentRatingKey; for movies: ratingKey */
  key: string;
  title: string;
  thumb: string;
  items: PlexMediaItem[];
  episodeCount: number;
}

function PlaylistDetail() {
  const { playlistKey } = useParams<{ playlistKey: string }>();
  const { server } = useAuth();
  const navigate = useNavigate();
  useScrollRestoration();
  const { setQueue } = useQueue();

  const [playlist, setPlaylist] = useState<PlexPlaylist | null>(null);
  const [items, setItems] = useState<PlexMediaItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Grouped view
  const [grouped, setGrouped] = useState(false);
  const [expandedShowKey, setExpandedShowKey] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  const refreshItems = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const { openContextMenu, overlays: menuOverlays } = useMediaContextMenu({
    onRefresh: refreshItems,
  });
  const { getPlayHandler, playOverlay } = usePlayAction();

  // Fetch playlist items
  useEffect(() => {
    if (!server || !playlistKey) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getPlaylistItems(
          server.uri,
          server.accessToken,
          playlistKey
        );
        if (!cancelled) {
          setItems(result.items);
          setTotalSize(result.totalSize);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load playlist"
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, playlistKey, refreshKey]);

  // Fetch playlist metadata separately for title/summary
  useEffect(() => {
    if (!server || !playlistKey) return;
    let cancelled = false;

    (async () => {
      try {
        const all = await getPlaylists(server.uri, server.accessToken);
        if (!cancelled) {
          const match = all.find((p) => p.ratingKey === playlistKey);
          if (match) setPlaylist(match);
        }
      } catch {
        // Non-critical — title falls back to "Playlist"
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, playlistKey, refreshKey]);

  useEffect(() => {
    if (playlist) document.title = `${playlist.title} - Prexu`;
  }, [playlist]);

  // Focus title input when entering edit mode
  useEffect(() => {
    if (isEditing) titleInputRef.current?.focus();
  }, [isEditing]);

  // ── Play All / Shuffle ──

  const handlePlayAll = useCallback(() => {
    const queueItems = buildQueueFromItems(items);
    if (queueItems.length === 0) return;
    setQueue(queueItems, 0);
    navigate(`/play/${queueItems[0].ratingKey}`);
  }, [items, setQueue, navigate]);

  const handleShuffle = useCallback(() => {
    const queueItems = shuffleArray(buildQueueFromItems(items));
    if (queueItems.length === 0) return;
    setQueue(queueItems, 0, true);
    navigate(`/play/${queueItems[0].ratingKey}`);
  }, [items, setQueue, navigate]);

  // ── Edit ──

  const handleStartEdit = useCallback(() => {
    setEditTitle(playlist?.title ?? "");
    setEditSummary(playlist?.summary ?? "");
    setIsEditing(true);
  }, [playlist]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!server || !playlistKey) return;
    setIsSaving(true);
    try {
      await updatePlaylist(server.uri, server.accessToken, playlistKey, {
        title: editTitle.trim(),
        summary: editSummary.trim(),
      });
      cacheInvalidate("playlists:all");
      setPlaylist((prev) =>
        prev
          ? { ...prev, title: editTitle.trim(), summary: editSummary.trim() }
          : prev
      );
      setIsEditing(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update playlist"
      );
    } finally {
      setIsSaving(false);
    }
  }, [server, playlistKey, editTitle, editSummary]);

  // ── Delete ──

  const handleDelete = useCallback(async () => {
    if (!server || !playlistKey) return;
    setIsDeleting(true);
    try {
      await deletePlaylist(server.uri, server.accessToken, playlistKey);
      cacheInvalidate("playlists:all");
      navigate("/playlists", { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete playlist"
      );
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [server, playlistKey, navigate]);

  // ── Remove item ──

  const handleRemoveItem = useCallback(
    async (item: PlexMediaItem) => {
      if (!server || !playlistKey || item.playlistItemID == null) return;
      try {
        await removeFromPlaylist(
          server.uri,
          server.accessToken,
          playlistKey,
          item.playlistItemID
        );
        cacheInvalidate("playlists:all");
        refreshItems();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to remove item"
        );
      }
    },
    [server, playlistKey, refreshItems]
  );

  // ── Reorder items ──

  const handleMoveItem = useCallback(
    async (item: PlexMediaItem, direction: "top" | "up" | "down" | "bottom") => {
      if (!server || !playlistKey || item.playlistItemID == null) return;
      const idx = items.findIndex(
        (i) => i.playlistItemID === item.playlistItemID
      );
      if (idx === -1) return;

      let afterId: number;
      if (direction === "top") {
        afterId = -1; // Move to first
      } else if (direction === "up") {
        if (idx <= 0) return;
        afterId = idx >= 2 ? items[idx - 2].playlistItemID! : -1;
      } else if (direction === "down") {
        if (idx >= items.length - 1) return;
        afterId = items[idx + 1].playlistItemID!;
      } else {
        // bottom
        afterId = items[items.length - 1].playlistItemID!;
      }

      try {
        await movePlaylistItem(
          server.uri,
          server.accessToken,
          playlistKey,
          item.playlistItemID,
          afterId
        );
        refreshItems();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to move item"
        );
      }
    },
    [server, playlistKey, items, refreshItems]
  );

  // ── Build extra context menu items for each playlist item ──

  const getExtraMenuItems = useCallback(
    (item: PlexMediaItem, index: number): ContextMenuItem[] => {
      const extras: ContextMenuItem[] = [];

      extras.push({
        label: "Remove from Playlist",
        dividerAbove: true,
        onClick: () => handleRemoveItem(item),
      });

      if (index > 0) {
        extras.push({
          label: "Move to Top",
          onClick: () => handleMoveItem(item, "top"),
        });
        extras.push({
          label: "Move Up",
          onClick: () => handleMoveItem(item, "up"),
        });
      }
      if (index < items.length - 1) {
        extras.push({
          label: "Move Down",
          onClick: () => handleMoveItem(item, "down"),
        });
        extras.push({
          label: "Move to Bottom",
          onClick: () => handleMoveItem(item, "bottom"),
        });
      }

      return extras;
    },
    [handleRemoveItem, handleMoveItem, items.length]
  );

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  const hasPlayableItems = items.some(
    (i) => i.type === "movie" || i.type === "episode"
  );

  // Group episodes by show, keep movies as individual entries
  const groups = useMemo<PlaylistGroup[]>(() => {
    if (!grouped) return [];
    const showMap = new Map<string, PlaylistGroup>();
    const result: PlaylistGroup[] = [];

    for (const item of items) {
      const ep = item as PlexEpisode;
      if (item.type === "episode" && ep.grandparentRatingKey) {
        let group = showMap.get(ep.grandparentRatingKey);
        if (!group) {
          group = {
            type: "show-group",
            key: ep.grandparentRatingKey,
            title: ep.grandparentTitle,
            thumb: ep.grandparentThumb || item.thumb,
            items: [],
            episodeCount: 0,
          };
          showMap.set(ep.grandparentRatingKey, group);
          result.push(group);
        }
        group.items.push(item);
        group.episodeCount++;
      } else {
        result.push({
          type: "movie",
          key: item.ratingKey,
          title: getMediaTitle(item),
          thumb: getMediaPoster(item),
          items: [item],
          episodeCount: 1,
        });
      }
    }
    return result;
  }, [items, grouped]);

  // Check if grouping would actually reduce clutter (has any show with 2+ episodes)
  const hasGroupableContent = useMemo(
    () => {
      const showCounts = new Map<string, number>();
      for (const item of items) {
        const ep = item as PlexEpisode;
        if (item.type === "episode" && ep.grandparentRatingKey) {
          showCounts.set(ep.grandparentRatingKey, (showCounts.get(ep.grandparentRatingKey) ?? 0) + 1);
        }
      }
      return Array.from(showCounts.values()).some((c) => c >= 2);
    },
    [items],
  );

  return (
    <div style={styles.container}>
      {/* Title — editable or static */}
      {isEditing ? (
        <div style={styles.editSection}>
          <input
            ref={titleInputRef}
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            style={styles.editTitleInput}
            placeholder="Playlist title"
            aria-label="Playlist title"
          />
          <textarea
            value={editSummary}
            onChange={(e) => setEditSummary(e.target.value)}
            style={styles.editSummaryInput}
            placeholder="Description (optional)"
            aria-label="Playlist description"
            rows={3}
          />
          <div style={styles.editActions}>
            <button
              onClick={handleSaveEdit}
              disabled={isSaving || !editTitle.trim()}
              style={{
                ...styles.saveButton,
                opacity: isSaving || !editTitle.trim() ? 0.5 : 1,
              }}
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button onClick={handleCancelEdit} style={styles.cancelButton}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <h2 style={styles.title}>{playlist?.title || "Playlist"}</h2>
          {playlist?.summary && (
            <p style={styles.summary}>
              {decodeHtmlEntities(playlist.summary)}
            </p>
          )}
        </>
      )}

      {error && (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            refreshItems();
          }}
        />
      )}

      {!isLoading && !error && totalSize > 0 && (
        <p style={styles.count}>
          {totalSize.toLocaleString()} item{totalSize !== 1 ? "s" : ""}
        </p>
      )}

      {/* Action buttons */}
      {!isLoading && !error && !isEditing && items.length > 0 && (
        <div style={styles.actions}>
          {hasPlayableItems && (
            <>
              <button onClick={handlePlayAll} style={styles.playAllButton}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
                Play All
              </button>
              <button onClick={handleShuffle} style={styles.shuffleButton}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 3 21 3 21 8" />
                  <line x1={4} y1={20} x2={21} y2={3} />
                  <polyline points="21 16 21 21 16 21" />
                  <line x1={15} y1={15} x2={21} y2={21} />
                  <line x1={4} y1={4} x2={9} y2={9} />
                </svg>
                Shuffle
              </button>
            </>
          )}
          {hasGroupableContent && (
            <button
              onClick={() => { setGrouped(!grouped); setExpandedShowKey(null); }}
              style={{
                ...styles.shuffleButton,
                ...(grouped ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}),
              }}
              title={grouped ? "Show all items" : "Group by show"}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x={3} y={3} width={7} height={7} rx={1} />
                <rect x={14} y={3} width={7} height={7} rx={1} />
                <rect x={3} y={14} width={7} height={7} rx={1} />
                <rect x={14} y={14} width={7} height={7} rx={1} />
              </svg>
              {grouped ? "Show All" : "Group"}
            </button>
          )}
          <button onClick={handleStartEdit} style={styles.iconButton} title="Edit playlist">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            style={styles.deleteIconButton}
            title="Delete playlist"
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div style={styles.deleteConfirm}>
          <p style={styles.deleteConfirmText}>
            Delete "{playlist?.title}"? This cannot be undone.
          </p>
          <div style={styles.deleteConfirmActions}>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              style={{
                ...styles.deleteConfirmButton,
                opacity: isDeleting ? 0.5 : 1,
              }}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              style={styles.cancelButton}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <LibraryGrid>
        {isLoading &&
          Array.from({ length: 24 }).map((_, i) => <SkeletonCard key={i} />)}

        {!grouped &&
          items.map((item, index) => (
            <PosterCard
              key={`${item.ratingKey}-${index}`}
              ratingKey={item.ratingKey}
              imageUrl={posterUrl(getMediaPoster(item))}
              title={getMediaTitle(item)}
              subtitle={getMediaSubtitle(item)}
              progress={getProgress(item)}
              watched={isWatched(item)}
              onClick={() => navigate(`/item/${item.ratingKey}`)}
              onPlay={getPlayHandler(item)}
              showMoreButton
              onContextMenu={(e) =>
                openContextMenu(e, item, getExtraMenuItems(item, index))
              }
              onMoreClick={(e) =>
                openContextMenu(e, item, getExtraMenuItems(item, index))
              }
            />
          ))}

        {grouped &&
          groups.map((group) => {
            if (group.type === "movie") {
              const item = group.items[0];
              const flatIndex = items.indexOf(item);
              return (
                <PosterCard
                  key={group.key}
                  ratingKey={item.ratingKey}
                  imageUrl={posterUrl(getMediaPoster(item))}
                  title={getMediaTitle(item)}
                  subtitle={getMediaSubtitle(item)}
                  progress={getProgress(item)}
                  watched={isWatched(item)}
                  onClick={() => navigate(`/item/${item.ratingKey}`)}
                  onPlay={getPlayHandler(item)}
                  showMoreButton
                  onContextMenu={(e) =>
                    openContextMenu(e, item, getExtraMenuItems(item, flatIndex))
                  }
                  onMoreClick={(e) =>
                    openContextMenu(e, item, getExtraMenuItems(item, flatIndex))
                  }
                />
              );
            }
            return (
              <PosterCard
                key={`group-${group.key}`}
                ratingKey={group.key}
                imageUrl={posterUrl(group.thumb)}
                title={group.title}
                subtitle={`${group.episodeCount} episode${group.episodeCount !== 1 ? "s" : ""}`}
                onClick={() =>
                  setExpandedShowKey(expandedShowKey === group.key ? null : group.key)
                }
              />
            );
          })}
      </LibraryGrid>

      {/* Expanded show episodes */}
      {grouped && expandedShowKey && (() => {
        const group = groups.find((g) => g.key === expandedShowKey);
        if (!group || group.type !== "show-group") return null;
        return (
          <div style={styles.expandedSection}>
            <div style={styles.expandedHeader}>
              <h3 style={styles.expandedTitle}>{group.title}</h3>
              <span style={styles.expandedCount}>
                {group.episodeCount} episode{group.episodeCount !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => setExpandedShowKey(null)}
                style={styles.expandedClose}
                aria-label="Close"
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <line x1={18} y1={6} x2={6} y2={18} />
                  <line x1={6} y1={6} x2={18} y2={18} />
                </svg>
              </button>
            </div>
            <LibraryGrid>
              {group.items.map((item) => {
                const flatIndex = items.indexOf(item);
                return (
                  <PosterCard
                    key={`${item.ratingKey}-${flatIndex}`}
                    ratingKey={item.ratingKey}
                    imageUrl={posterUrl(getMediaPoster(item))}
                    title={getMediaTitle(item)}
                    subtitle={getMediaSubtitle(item)}
                    progress={getProgress(item)}
                    watched={isWatched(item)}
                    onClick={() => navigate(`/item/${item.ratingKey}`)}
                    onPlay={getPlayHandler(item)}
                    showMoreButton
                    onContextMenu={(e) =>
                      openContextMenu(e, item, getExtraMenuItems(item, flatIndex))
                    }
                    onMoreClick={(e) =>
                      openContextMenu(e, item, getExtraMenuItems(item, flatIndex))
                    }
                  />
                );
              })}
            </LibraryGrid>
          </div>
        );
      })()}

      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <line x1={8} y1={6} x2={21} y2={6} />
              <line x1={8} y1={12} x2={21} y2={12} />
              <line x1={8} y1={18} x2={21} y2={18} />
              <line x1={3} y1={6} x2={3.01} y2={6} />
              <line x1={3} y1={12} x2={3.01} y2={12} />
              <line x1={3} y1={18} x2={3.01} y2={18} />
            </svg>
          }
          title="Empty playlist"
          subtitle="This playlist doesn't have any items yet."
          action={{ label: "Back to Playlists", onClick: () => navigate("/playlists") }}
        />
      )}

      {menuOverlays}
      {playOverlay}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 600,
    marginBottom: "0.5rem",
  },
  summary: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    maxWidth: "600px",
    marginBottom: "1rem",
  },
  count: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    marginBottom: "0.75rem",
  },
  // Action buttons row
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "1.25rem",
    flexWrap: "wrap",
  },
  playAllButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.5rem 1rem",
    borderRadius: "8px",
    border: "none",
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  shuffleButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.5rem 1rem",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    fontWeight: 500,
    cursor: "pointer",
  },
  iconButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    marginLeft: "auto",
  },
  deleteIconButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  // Edit mode
  editSection: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    marginBottom: "1rem",
    maxWidth: "600px",
  },
  editTitleInput: {
    fontSize: "1.3rem",
    fontWeight: 600,
    padding: "0.4rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    outline: "none",
  },
  editSummaryInput: {
    fontSize: "0.85rem",
    padding: "0.4rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    outline: "none",
    resize: "vertical" as const,
    lineHeight: 1.5,
    fontFamily: "inherit",
  },
  editActions: {
    display: "flex",
    gap: "0.5rem",
  },
  saveButton: {
    padding: "0.4rem 0.75rem",
    borderRadius: "6px",
    border: "none",
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  cancelButton: {
    padding: "0.4rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  // Delete confirmation
  deleteConfirm: {
    padding: "1rem",
    marginBottom: "1rem",
    borderRadius: "8px",
    background: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
  },
  deleteConfirmText: {
    fontSize: "0.9rem",
    color: "var(--text-primary)",
    margin: "0 0 0.75rem",
  },
  deleteConfirmActions: {
    display: "flex",
    gap: "0.5rem",
  },
  expandedSection: {
    marginTop: "1.5rem",
    padding: "1rem",
    borderRadius: "8px",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
  },
  expandedHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "1rem",
  },
  expandedTitle: {
    fontSize: "1.1rem",
    fontWeight: 600,
    margin: 0,
  },
  expandedCount: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  expandedClose: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  deleteConfirmButton: {
    padding: "0.4rem 0.75rem",
    borderRadius: "6px",
    border: "none",
    background: "#ef4444",
    color: "#fff",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

export default PlaylistDetail;
