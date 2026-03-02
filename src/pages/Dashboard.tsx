import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePreferences } from "../hooks/usePreferences";
import { useDashboard } from "../hooks/useDashboard";
import {
  getImageUrl,
  markAsWatched,
  markAsUnwatched,
} from "../services/plex-library";
import HorizontalRow from "../components/HorizontalRow";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import EpisodeExpander from "../components/EpisodeExpander";
import ContextMenu from "../components/ContextMenu";
import type { ContextMenuItem } from "../components/ContextMenu";
import SessionCreator from "../components/SessionCreator";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import type {
  PlexMediaItem,
  PlexEpisode,
  GroupedRecentItem,
} from "../types/library";

interface ContextMenuState {
  position: { x: number; y: number };
  item: PlexMediaItem;
  section: "onDeck" | "movies" | "shows";
}

interface SessionCreatorState {
  ratingKey: string;
  title: string;
  mediaType: "movie" | "episode";
}

const POSTER_SIZES = { small: 130, medium: 160, large: 200 } as const;

/** Pure helper — subtitle for a media item (movie year, episode code) */
function getSubtitle(item: PlexMediaItem): string {
  if (item.type === "movie") {
    const movie = item as { year?: number };
    return movie.year ? String(movie.year) : "";
  }
  if (item.type === "episode") {
    const ep = item as PlexEpisode;
    return `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")}`;
  }
  return "";
}

/** Pure helper — subtitle for a grouped show card */
function getGroupSubtitle(group: GroupedRecentItem): string {
  if (group.episodes.length === 1) {
    const ep = group.episodes[0];
    return `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")} · ${ep.title}`;
  }
  if (group.episodes.length > 1) {
    return `${group.episodes.length} new episodes`;
  }
  if (group.episodeCount > 0) {
    return `${group.episodeCount} episodes`;
  }
  return "Recently Added";
}

/** Pure helper — playback progress ratio (0-1) or undefined */
function getProgress(item: PlexMediaItem): number | undefined {
  const withOffset = item as { viewOffset?: number; duration?: number };
  if (withOffset.viewOffset && withOffset.duration) {
    return withOffset.viewOffset / withOffset.duration;
  }
  return undefined;
}

function Dashboard() {
  const { server } = useAuth();
  const { preferences } = usePreferences();
  const { recentMovies, recentShows, onDeck, isLoading, error, refresh } =
    useDashboard();
  const posterWidth = POSTER_SIZES[preferences.appearance.posterSize];
  const sections = preferences.appearance.dashboardSections;
  const navigate = useNavigate();
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [expanderClosing, setExpanderClosing] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sessionCreator, setSessionCreator] =
    useState<SessionCreatorState | null>(null);

  // Reset expansion when data changes (e.g., server switch)
  useEffect(() => {
    setExpandedGroupKey(null);
  }, [recentShows]);

  const expandedGroup =
    expandedGroupKey
      ? recentShows.find(
          (g) => g.groupKey === expandedGroupKey && g.kind === "show-group"
        ) ?? null
      : null;

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  const openContextMenu = useCallback(
    (e: React.MouseEvent, item: PlexMediaItem, section: ContextMenuState["section"]) => {
      setContextMenu({ position: { x: e.clientX, y: e.clientY }, item, section });
    },
    []
  );

  const buildMenuItems = useCallback(
    (item: PlexMediaItem, section: ContextMenuState["section"]): ContextMenuItem[] => {
      if (!server) return [];
      const items: ContextMenuItem[] = [];
      const hasView = (item as { viewCount?: number }).viewCount;

      if (hasView) {
        items.push({
          label: "Mark as Unwatched",
          onClick: async () => {
            await markAsUnwatched(server.uri, server.accessToken, item.ratingKey);
            refresh();
          },
        });
      } else {
        items.push({
          label: "Mark as Watched",
          onClick: async () => {
            await markAsWatched(server.uri, server.accessToken, item.ratingKey);
            refresh();
          },
        });
      }

      // "Remove from Continue Watching" = Mark as Watched (only in onDeck section)
      if (section === "onDeck" && !hasView) {
        items.push({
          label: "Remove from Continue Watching",
          onClick: async () => {
            await markAsWatched(server.uri, server.accessToken, item.ratingKey);
            refresh();
          },
        });
      }

      // Watch Together (movies & episodes only)
      if (item.type === "movie" || item.type === "episode") {
        items.push({
          label: "Watch Together...",
          dividerAbove: true,
          onClick: () => {
            setSessionCreator({
              ratingKey: item.ratingKey,
              title: item.type === "episode"
                ? `${(item as PlexEpisode).grandparentTitle} - ${item.title}`
                : item.title,
              mediaType: item.type as "movie" | "episode",
            });
          },
        });
      }

      items.push({
        label: "Get Info",
        dividerAbove: item.type !== "movie" && item.type !== "episode",
        onClick: () => navigate(`/item/${item.ratingKey}`),
      });

      return items;
    },
    [server, refresh, navigate]
  );

  if (error) {
    return (
      <div style={styles.container}>
        <ErrorState message={error} onRetry={refresh} />
      </div>
    );
  }

  const hasContent =
    (sections.continueWatching && onDeck.length > 0) ||
    (sections.recentMovies && recentMovies.length > 0) ||
    (sections.recentShows && recentShows.length > 0);

  return (
    <div style={styles.container}>
      {/* Continue Watching */}
      {sections.continueWatching && (isLoading ? (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Continue Watching</h3>
          <div style={styles.skeletonRow}>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </div>
        </section>
      ) : (
        onDeck.length > 0 && (
          <HorizontalRow title="Continue Watching">
            {onDeck.map((item) => {
              const isEpisode = item.type === "episode";
              const ep = isEpisode ? (item as PlexEpisode) : null;
              return (
                <PosterCard
                  key={item.ratingKey}
                  imageUrl={posterUrl(
                    ep?.grandparentThumb || item.thumb
                  )}
                  title={ep?.grandparentTitle || item.title}
                  subtitle={
                    ep
                      ? `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")} · ${ep.title}`
                      : getSubtitle(item)
                  }
                  progress={getProgress(item)}
                  width={posterWidth}
                  onClick={() => navigate(`/item/${item.ratingKey}`)}
                  showMoreButton
                  onContextMenu={(e) => openContextMenu(e, item, "onDeck")}
                  onMoreClick={(e) => openContextMenu(e, item, "onDeck")}
                />
              );
            })}
          </HorizontalRow>
        )
      ))}

      {/* Recently Added in Movies */}
      {sections.recentMovies && (isLoading ? (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Recently Added in Movies</h3>
          <div style={styles.skeletonRow}>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </div>
        </section>
      ) : (
        recentMovies.length > 0 && (
          <HorizontalRow title="Recently Added in Movies">
            {recentMovies.map((item) => (
              <PosterCard
                key={item.ratingKey}
                imageUrl={posterUrl(item.thumb)}
                title={item.title}
                subtitle={getSubtitle(item)}
                width={posterWidth}
                onClick={() => navigate(`/item/${item.ratingKey}`)}
                showMoreButton
                onContextMenu={(e) => openContextMenu(e, item, "movies")}
                onMoreClick={(e) => openContextMenu(e, item, "movies")}
              />
            ))}
          </HorizontalRow>
        )
      ))}

      {/* Recently Added in TV Shows */}
      {sections.recentShows && (isLoading ? (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Recently Added in TV Shows</h3>
          <div style={styles.skeletonRow}>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </div>
        </section>
      ) : (
        recentShows.length > 0 && (
          <HorizontalRow title="Recently Added in TV Shows">
            {recentShows.map((group) => {
              const isExpandable =
                group.kind === "show-group" && group.episodes.length > 1;
              const isActive = expandedGroupKey === group.groupKey;

              return (
                <div
                  key={group.groupKey}
                  style={isActive ? styles.activeCardWrapper : undefined}
                >
                  <PosterCard
                    imageUrl={posterUrl(group.thumb)}
                    title={group.title}
                    subtitle={getGroupSubtitle(group)}
                    width={posterWidth}
                    badge={
                      group.episodeCount > 1
                        ? `+${group.episodeCount}`
                        : "NEW"
                    }
                    onClick={() => {
                      if (isExpandable) {
                        if (isActive) {
                          setExpanderClosing(true);
                          setTimeout(() => {
                            setExpandedGroupKey(null);
                            setExpanderClosing(false);
                          }, 250);
                        } else {
                          setExpandedGroupKey(group.groupKey);
                        }
                      } else {
                        navigate(`/item/${group.groupKey}`);
                      }
                    }}
                    showMoreButton
                    onContextMenu={(e) =>
                      openContextMenu(e, group.representativeItem, "shows")
                    }
                    onMoreClick={(e) =>
                      openContextMenu(e, group.representativeItem, "shows")
                    }
                  />
                </div>
              );
            })}
          </HorizontalRow>
        )
      ))}

      {/* Episode expansion panel */}
      {expandedGroup && server && (
        <EpisodeExpander
          group={expandedGroup}
          serverUri={server.uri}
          serverToken={server.accessToken}
          closing={expanderClosing}
          onClose={() => {
            setExpanderClosing(true);
            setTimeout(() => {
              setExpandedGroupKey(null);
              setExpanderClosing(false);
            }, 250);
          }}
          onPlayEpisode={(ratingKey) => navigate(`/play/${ratingKey}`)}
          onViewShow={(groupKey) => navigate(`/item/${groupKey}`)}
          onViewEpisode={(ratingKey) => navigate(`/item/${ratingKey}`)}
        />
      )}

      {/* Empty state */}
      {!isLoading && !hasContent && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          }
          title="No recent activity"
          subtitle="Add some media to your Plex libraries to see it here."
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          items={buildMenuItems(contextMenu.item, contextMenu.section)}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Watch Together session creator */}
      {sessionCreator && (
        <SessionCreator
          ratingKey={sessionCreator.ratingKey}
          title={sessionCreator.title}
          mediaType={sessionCreator.mediaType}
          onClose={() => setSessionCreator(null)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
  },
  section: {
    marginBottom: "1.75rem",
  },
  sectionTitle: {
    fontSize: "1.15rem",
    fontWeight: 600,
    marginBottom: "0.75rem",
  },
  skeletonRow: {
    display: "flex",
    gap: "0.75rem",
    overflow: "hidden",
  },
  activeCardWrapper: {
    borderBottom: "2px solid var(--accent)",
    borderRadius: "8px",
    flexShrink: 0,
  },
};

export default Dashboard;
