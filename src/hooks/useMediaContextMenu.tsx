/**
 * Shared hook for poster-card context menus.
 *
 * Encapsulates menu item construction and all overlay state
 * (ContextMenu, SessionCreator, PlaylistPicker, FixMatchDialog)
 * so each page only needs `openContextMenu` + rendering `{overlays}`.
 */

import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import { useDownloads } from "./useDownloads";
import { useToast } from "./useToast";
import { markAsWatched, markAsUnwatched } from "../services/plex-library";
import { buildDownloadItem } from "../components/detail/DownloadButton";
import ContextMenu from "../components/ContextMenu";
import type { ContextMenuItem } from "../components/ContextMenu";
import SessionCreator from "../components/SessionCreator";
import PlaylistPicker from "../components/PlaylistPicker";
import FixMatchDialog from "../components/FixMatchDialog";
import type { PlexMediaItem, PlexEpisode, PlexSeason } from "../types/library";

// ── Internal state shapes ──

interface ContextMenuState {
  position: { x: number; y: number };
  item: PlexMediaItem;
  extraItems: ContextMenuItem[];
}

interface SessionCreatorState {
  ratingKey: string;
  title: string;
  mediaType: "movie" | "episode";
}

interface PlaylistPickerState {
  ratingKey: string;
  title: string;
}

interface FixMatchTarget {
  ratingKey: string;
  title: string;
  year?: string;
  mediaType: string;
}

// ── Public API ──

export interface UseMediaContextMenuOptions {
  /** Called after data changes (watched toggle, match applied) so the page can refresh */
  onRefresh?: () => void;
  /** Show "Add to Playlist…" option. Default: true */
  showAddToPlaylist?: boolean;
}

export function useMediaContextMenu(options: UseMediaContextMenuOptions = {}) {
  const { showAddToPlaylist = true } = options;
  const { server, activeUser } = useAuth();
  const { isDownloaded, isDownloading, queueDownload } = useDownloads();
  const { toast } = useToast();
  const isAdmin = activeUser?.isAdmin ?? false;
  const navigate = useNavigate();

  // Use ref for onRefresh to keep getMenuItems stable
  const onRefreshRef = useRef(options.onRefresh);
  onRefreshRef.current = options.onRefresh;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sessionCreator, setSessionCreator] =
    useState<SessionCreatorState | null>(null);
  const [playlistPicker, setPlaylistPicker] =
    useState<PlaylistPickerState | null>(null);
  const [fixMatchTarget, setFixMatchTarget] =
    useState<FixMatchTarget | null>(null);

  /**
   * Open the context menu for a media item.
   * Optionally pass extra items (e.g. "Remove from Continue Watching")
   * that are inserted after the watched toggle.
   */
  const openContextMenu = useCallback(
    (
      e: React.MouseEvent,
      item: PlexMediaItem,
      extraItems?: ContextMenuItem[],
    ) => {
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        item,
        extraItems: extraItems ?? [],
      });
    },
    [],
  );

  /** Build the full menu for the given item. */
  const getMenuItems = useCallback(
    (item: PlexMediaItem, extraItems: ContextMenuItem[]): ContextMenuItem[] => {
      if (!server) return [];
      const items: ContextMenuItem[] = [];
      const hasView = (item as { viewCount?: number }).viewCount;
      const hasProgress = (item as { viewOffset?: number }).viewOffset;

      // ── Watched / Unwatched toggle ──
      if (hasView) {
        items.push({
          label: "Mark as Unwatched",
          onClick: async () => {
            await markAsUnwatched(
              server.uri,
              server.accessToken,
              item.ratingKey,
            );
            onRefreshRef.current?.();
          },
        });
      } else {
        items.push({
          label: "Mark as Watched",
          onClick: async () => {
            await markAsWatched(
              server.uri,
              server.accessToken,
              item.ratingKey,
            );
            onRefreshRef.current?.();
          },
        });
        // Also offer "Mark as Unwatched" for partially-watched items
        if (hasProgress) {
          items.push({
            label: "Mark as Unwatched",
            onClick: async () => {
              await markAsUnwatched(
                server.uri,
                server.accessToken,
                item.ratingKey,
              );
              onRefreshRef.current?.();
            },
          });
        }
      }

      // ── Page-specific extra items ──
      if (extraItems.length > 0) {
        items.push(...extraItems);
      }

      // ── Watch Together (movies & episodes) ──
      if (item.type === "movie" || item.type === "episode") {
        items.push({
          label: "Watch Together...",
          dividerAbove: true,
          onClick: () => {
            setSessionCreator({
              ratingKey: item.ratingKey,
              title:
                item.type === "episode"
                  ? `${(item as PlexEpisode).grandparentTitle} - ${item.title}`
                  : item.title,
              mediaType: item.type as "movie" | "episode",
            });
          },
        });
      }

      // ── Add to Playlist (movies & episodes) ──
      if (
        showAddToPlaylist &&
        (item.type === "movie" || item.type === "episode")
      ) {
        items.push({
          label: "Add to Playlist...",
          onClick: () =>
            setPlaylistPicker({
              ratingKey: item.ratingKey,
              title: item.title,
            }),
        });
      }

      // ── Download (movies & episodes) ──
      if (
        (item.type === "movie" || item.type === "episode") &&
        server
      ) {
        const alreadyDownloaded = isDownloaded(item.ratingKey);
        const currentlyDownloading = isDownloading(item.ratingKey);
        if (!alreadyDownloaded && !currentlyDownloading) {
          items.push({
            label: "Download",
            onClick: () => {
              const dlItem = buildDownloadItem(
                item as import("../types/library").PlexMovie | import("../types/library").PlexEpisode,
                server.uri,
              );
              if (dlItem) {
                queueDownload(dlItem);
                toast("Download started", "success");
              }
            },
          });
        }
      }

      // ── Fix Match (admin — movies, shows, episodes, seasons → parent show) ──
      if (isAdmin && (item.type === "movie" || item.type === "show")) {
        items.push({
          label: "Fix Match...",
          dividerAbove: true,
          onClick: () =>
            setFixMatchTarget({
              ratingKey: item.ratingKey,
              title: item.title,
              year: (item as { year?: number }).year
                ? String((item as { year?: number }).year)
                : undefined,
              mediaType: item.type,
            }),
        });
      } else if (isAdmin && item.type === "episode") {
        const ep = item as PlexEpisode;
        items.push({
          label: "Fix Match...",
          dividerAbove: true,
          onClick: () =>
            setFixMatchTarget({
              ratingKey: ep.grandparentRatingKey,
              title: ep.grandparentTitle,
              year: ep.year ? String(ep.year) : undefined,
              mediaType: "show",
            }),
        });
      } else if (isAdmin && item.type === "season") {
        const season = item as unknown as PlexSeason;
        items.push({
          label: "Fix Match...",
          dividerAbove: true,
          onClick: () =>
            setFixMatchTarget({
              ratingKey: season.parentRatingKey,
              title: season.parentTitle,
              mediaType: "show",
            }),
        });
      }

      // ── Get Info (always last) ──
      const hasFixMatch =
        isAdmin &&
        (item.type === "movie" ||
          item.type === "show" ||
          item.type === "episode" ||
          item.type === "season");
      items.push({
        label: "Get Info",
        dividerAbove:
          item.type !== "movie" &&
          item.type !== "episode" &&
          !hasFixMatch,
        onClick: () => navigate(`/item/${item.ratingKey}`),
      });

      return items;
    },
    [server, isAdmin, navigate, showAddToPlaylist, isDownloaded, isDownloading, queueDownload, toast],
  );

  // ── Overlays (render at the bottom of the page component) ──

  const overlays = (
    <>
      {contextMenu && (
        <ContextMenu
          items={getMenuItems(contextMenu.item, contextMenu.extraItems)}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}

      {sessionCreator && (
        <SessionCreator
          ratingKey={sessionCreator.ratingKey}
          title={sessionCreator.title}
          mediaType={sessionCreator.mediaType}
          onClose={() => setSessionCreator(null)}
        />
      )}

      {playlistPicker && (
        <PlaylistPicker
          ratingKey={playlistPicker.ratingKey}
          title={playlistPicker.title}
          onClose={() => setPlaylistPicker(null)}
        />
      )}

      {fixMatchTarget && (
        <FixMatchDialog
          ratingKey={fixMatchTarget.ratingKey}
          currentTitle={fixMatchTarget.title}
          currentYear={fixMatchTarget.year}
          mediaType={fixMatchTarget.mediaType}
          onClose={() => setFixMatchTarget(null)}
          onMatchApplied={() => onRefreshRef.current?.()}
        />
      )}
    </>
  );

  return { openContextMenu, overlays };
}
