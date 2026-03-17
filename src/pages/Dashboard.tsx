import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePreferences } from "../hooks/usePreferences";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { useDashboard } from "../hooks/useDashboard";
import { useMediaContextMenu } from "../hooks/useMediaContextMenu";
import { usePlayAction } from "../hooks/usePlayAction";
import { getImageUrl, markAsWatched } from "../services/plex-library";
import {
  getDismissedRecommendations,
  saveDismissedRecommendations,
} from "../services/storage";
import HeroSlideshow from "../components/HeroSlideshow";
import type { HeroSlide } from "../components/HeroSlideshow";
import HorizontalRow from "../components/HorizontalRow";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import EpisodeExpander from "../components/EpisodeExpander";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { usePosterSize } from "../hooks/usePosterSize";
import {
  getMediaSubtitleShort as getSubtitle,
  getProgress,
  isWatched,
} from "../utils/media-helpers";
import type {
  PlexMediaItem,
  PlexEpisode,
  GroupedRecentItem,
} from "../types/library";

/** Pure helper — season label prefix for a grouped show (e.g. "Season 3 · ") */
function getSeasonLabel(group: GroupedRecentItem): string {
  // Episode-level data
  if (group.episodes.length > 0) {
    const seasons = new Set(group.episodes.map((e) => e.parentIndex));
    if (seasons.size === 1) {
      return `Season ${seasons.values().next().value} · `;
    }
    return "";
  }
  // Season-level data
  if (group.seasonIndices.length > 0) {
    const unique = new Set(group.seasonIndices);
    if (unique.size === 1) {
      return `Season ${unique.values().next().value} · `;
    }
    return "";
  }
  return "";
}

/** Pure helper — subtitle for a grouped show card */
function getGroupSubtitle(group: GroupedRecentItem): string {
  const seasonLabel = getSeasonLabel(group);
  if (group.episodes.length === 1) {
    const ep = group.episodes[0];
    return `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")} · ${ep.title}`;
  }
  if (group.episodes.length > 1) {
    return `${seasonLabel}${group.episodes.length} new episodes`;
  }
  if (group.episodeCount > 0) {
    return `${seasonLabel}${group.episodeCount} episodes`;
  }
  return "Recently Added";
}

function Dashboard() {
  const { server } = useAuth();
  const { preferences } = usePreferences();
  useScrollRestoration();
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const { recentMovies, recentShows, onDeck, isLoading, error, refresh } =
    useDashboard();
  const { posterWidth } = usePosterSize();
  const sections = preferences.appearance.dashboardSections;
  const navigate = useNavigate();
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [expanderClosing, setExpanderClosing] = useState(false);
  const { openContextMenu, overlays: menuOverlays } = useMediaContextMenu({
    onRefresh: refresh,
  });
  const { getPlayHandler, playOverlay } = usePlayAction();

  // Map ratingKey → PlexMediaItem for hero slide play handler
  const heroItemMap = useMemo(() => {
    const map = new Map<string, PlexMediaItem>();
    for (const item of onDeck) map.set(item.ratingKey, item);
    for (const movie of recentMovies) map.set(movie.ratingKey, movie);
    return map;
  }, [onDeck, recentMovies]);

  const handleHeroPlay = useCallback(
    (ratingKey: string, e: React.MouseEvent) => {
      const item = heroItemMap.get(ratingKey);
      if (item) {
        const handler = getPlayHandler(item);
        if (handler) {
          handler(e);
        } else {
          navigate(`/play/${ratingKey}`);
        }
      } else {
        navigate(`/play/${ratingKey}`);
      }
    },
    [heroItemMap, getPlayHandler, navigate],
  );

  // Dismissed recommendations
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const dismissedInitRef = useRef(false);

  useEffect(() => {
    if (dismissedInitRef.current) return;
    dismissedInitRef.current = true;
    getDismissedRecommendations().then((keys) => {
      if (keys.length > 0) setDismissedKeys(new Set(keys));
    });
  }, []);

  const handleDismissRecommendation = useCallback((ratingKey: string) => {
    setDismissedKeys((prev) => {
      const next = new Set(prev);
      next.add(ratingKey);
      saveDismissedRecommendations([...next]);
      return next;
    });
  }, []);

  // Pull-to-refresh (mobile only)
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!mobile || isRefreshing) return;
    if (containerRef.current && containerRef.current.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPulling.current) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      setPullDistance(Math.min(delta * 0.5, 80));
    }
  };

  const handleTouchEnd = () => {
    if (!isPulling.current) return;
    isPulling.current = false;
    if (pullDistance > 50) {
      setIsRefreshing(true);
      refresh();
      setTimeout(() => {
        setIsRefreshing(false);
        setPullDistance(0);
      }, 1000);
    } else {
      setPullDistance(0);
    }
  };

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

  const backdropUrl = (art: string) =>
    getImageUrl(server.uri, server.accessToken, art, 1920, 1080);

  // Build hero slides: Continue Watching items + top-rated unwatched movies
  const heroSlides: HeroSlide[] = (() => {
    const slides: HeroSlide[] = [];

    // Continue watching (first 5 — prefer backdrop art, fall back to poster thumb)
    for (const item of onDeck) {
      if (slides.length >= 5) break;
      const isEpisode = item.type === "episode";
      const ep = isEpisode ? (item as PlexEpisode) : null;
      const art = ep?.grandparentArt || item.art || ep?.grandparentThumb || item.thumb;
      if (!art) continue;
      slides.push({
        ratingKey: item.ratingKey,
        title: ep?.grandparentTitle || item.title,
        subtitle: ep
          ? `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")} · ${ep.title}`
          : getSubtitle(item),
        backdropUrl: backdropUrl(art),
        summary: item.summary,
        progress: getProgress(item),
        rating: (item as unknown as { rating?: number }).rating,
        category: "Continue Watching",
      });
    }

    // Top-rated unwatched movies (fill up to 10 total)
    const unwatchedMovies = recentMovies
      .filter((m) => !isWatched(m) && (m.art || m.thumb) && !dismissedKeys.has(m.ratingKey))
      .sort((a, b) =>
        ((b as unknown as { rating?: number }).rating ?? 0) -
        ((a as unknown as { rating?: number }).rating ?? 0)
      );
    for (const movie of unwatchedMovies) {
      if (slides.length >= 10) break;
      slides.push({
        ratingKey: movie.ratingKey,
        title: movie.title,
        subtitle: (movie as { year?: number }).year
          ? String((movie as { year?: number }).year)
          : undefined,
        backdropUrl: backdropUrl((movie.art || movie.thumb)!),
        summary: movie.summary,
        rating: (movie as unknown as { rating?: number }).rating,
        category: "Recommended for You",
      });
    }

    return slides;
  })();

  /** Build onDeck-specific extra items (Remove from Continue Watching). */
  const onDeckExtras = (item: PlexMediaItem) => {
    if (!server) return [];
    const hasView = (item as { viewCount?: number }).viewCount;
    if (hasView) return [];
    return [
      {
        label: "Remove from Continue Watching",
        onClick: async () => {
          await markAsWatched(server.uri, server.accessToken, item.ratingKey);
          refresh();
        },
      },
    ];
  };

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
    <div
      ref={containerRef}
      style={{
        ...styles.container,
        ...(mobile ? { padding: "1rem" } : {}),
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator (mobile) */}
      {mobile && pullDistance > 0 && (
        <div style={{
          display: "flex",
          justifyContent: "center",
          padding: `${pullDistance * 0.3}px 0`,
          transition: isPulling.current ? "none" : "padding 0.2s ease",
        }}>
          <div
            className="loading-spinner"
            style={{
              opacity: pullDistance > 50 ? 1 : pullDistance / 50,
              transform: `rotate(${pullDistance * 4}deg)`,
            }}
          />
        </div>
      )}
      {mobile && isRefreshing && (
        <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0" }}>
          <div className="loading-spinner" />
        </div>
      )}

      {/* Hero slideshow */}
      {!isLoading && heroSlides.length > 0 && (
        <HeroSlideshow slides={heroSlides} onDismiss={handleDismissRecommendation} onPlay={handleHeroPlay} />
      )}

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
                  ratingKey={item.ratingKey}
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
                  onPlay={getPlayHandler(item)}

                  showMoreButton
                  onContextMenu={(e) => openContextMenu(e, item, onDeckExtras(item))}
                  onMoreClick={(e) => openContextMenu(e, item, onDeckExtras(item))}
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
                ratingKey={item.ratingKey}
                imageUrl={posterUrl(item.thumb)}
                title={item.title}
                subtitle={getSubtitle(item)}
                width={posterWidth}
                watched={isWatched(item)}
                onClick={() => navigate(`/item/${item.ratingKey}`)}
                onPlay={getPlayHandler(item)}
                showMoreButton
                onContextMenu={(e) => openContextMenu(e, item)}
                onMoreClick={(e) => openContextMenu(e, item)}
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
              const isShowGroup = group.kind === "show-group";
              const isActive = expandedGroupKey === group.groupKey;

              return (
                <div
                  key={group.groupKey}
                  style={isActive ? styles.activeCardWrapper : undefined}
                >
                  <PosterCard
                    ratingKey={group.groupKey}
                    imageUrl={posterUrl(group.thumb)}
                    title={group.title}
                    subtitle={getGroupSubtitle(group)}
                    width={posterWidth}
                    badge={
                      group.episodeCount > 1
                        ? `+${group.episodeCount}`
                        : "NEW"
                    }
                    onClick={() => navigate(`/item/${group.groupKey}`)}
                    onExpand={
                      isShowGroup
                        ? () => {
                            if (isActive) {
                              setExpanderClosing(true);
                              setTimeout(() => {
                                setExpandedGroupKey(null);
                                setExpanderClosing(false);
                              }, 250);
                            } else {
                              setExpandedGroupKey(group.groupKey);
                            }
                          }
                        : undefined
                    }
                    isExpanded={isActive}
  
                    showMoreButton
                    onContextMenu={(e) =>
                      openContextMenu(e, group.representativeItem)
                    }
                    onMoreClick={(e) =>
                      openContextMenu(e, group.representativeItem)
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

      {menuOverlays}
      {playOverlay}
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
    flexShrink: 0,
  },
};

export default Dashboard;
