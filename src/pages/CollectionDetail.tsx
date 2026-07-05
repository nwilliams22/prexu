import { useEffect, useRef, useMemo, useCallback, memo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { NavigateFunction } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAuth } from "../hooks/useAuth";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { useMediaContextMenu } from "../hooks/useMediaContextMenu";
import { usePlayAction } from "../hooks/usePlayAction";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { useDetailItems } from "../hooks/useDetailItems";
import type { PlexServerLike } from "../hooks/useDetailItems";
import { useItemDetails } from "../hooks/useItemDetails";
import type { ItemDetail } from "../hooks/useItemDetails";
import { usePlayAll } from "../hooks/usePlayAll";
import {
  getItemMetadata,
  getCollectionItems,
  getImageUrl,
} from "../services/plex-library";
import { getInitials } from "../utils/text-format";
import LoadingGrid from "../components/LoadingGrid";
import ProgressBar from "../components/ProgressBar";
import SectionHeader from "../components/SectionHeader";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import DetailPageShell from "../components/detail/DetailPageShell";
import { findScrollAncestor } from "../components/VirtualizedLibraryGrid";
import { isWatched, decodeHtmlEntities } from "../utils/media-helpers";
import { detailStyles } from "../utils/detail-styles";
import type {
  PlexMediaItem,
  PlexCollection,
  PlexMovie,
  PlexRole,
  PlexTag,
} from "../types/library";

/** Format duration in milliseconds to "Xh Ym" */
function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export interface ItemRowProps {
  item: PlexMediaItem;
  /** Progressive metadata (cast, crew, genres, duration) for this item, if
   *  it has loaded yet — undefined while pending or not-yet-requested. */
  detail: ItemDetail | undefined;
  /** Whether THIS item's own detail query is still in flight (drives the
   *  per-row shimmer instead of a single shared loading flag, so unrelated
   *  rows don't re-render together whenever any other row's fetch settles). */
  isPending: boolean;
  mobile: boolean;
  thumbUrl: (thumb: string) => string;
  actorThumbUrl: (thumb: string) => string;
  navigate: NavigateFunction;
  onContextMenu: (e: React.MouseEvent, item: PlexMediaItem) => void;
  getPlayHandler: (
    item: PlexMediaItem,
  ) => ((e: React.MouseEvent) => void) | undefined;
}

/**
 * A single collection row (poster + cast/crew/genre metadata + play button).
 * Memoized and keyed by ratingKey (prexu-0szx.6) — with a stable `detail`
 * Map reference (see useItemDetails) and stable callback props from the
 * parent, an unrelated row's detail resolving or a sibling re-render no
 * longer forces every mounted row to re-render.
 *
 * Exported (alongside CollectionItemsList below) so the memoization and
 * virtualization/gated-fetch behavior can be verified directly in tests
 * without driving the full CollectionDetail page through every hook.
 */
export const ItemRow = memo(function ItemRow({
  item,
  detail,
  isPending,
  mobile,
  thumbUrl,
  actorThumbUrl,
  navigate,
  onContextMenu,
  getPlayHandler,
}: ItemRowProps) {
  const watched = isWatched(item);

  // Extract typed fields from detail
  const year = detail ? (detail as PlexMovie).year : undefined;
  const duration = detail ? (detail as PlexMovie).duration : undefined;
  const contentRating = detail
    ? (detail as PlexMovie).contentRating
    : undefined;
  const audienceRating = detail
    ? (detail as PlexMovie).audienceRating
    : undefined;
  const genres: PlexTag[] =
    detail && "Genre" in detail ? (detail as PlexMovie).Genre ?? [] : [];
  const directors: PlexTag[] =
    detail && "Director" in detail
      ? (detail as PlexMovie).Director ?? []
      : [];
  const roles: PlexRole[] = detail?.Role ?? [];
  const topCast = roles.slice(0, 6);
  const summary = detail?.summary ?? item.summary;

  return (
    <div
      style={{
        ...styles.itemRow,
        ...(mobile ? styles.itemRowMobile : {}),
        ...(watched ? { opacity: 0.7 } : {}),
      }}
      onClick={() => navigate(`/item/${item.ratingKey}`)}
      onContextMenu={(e) => onContextMenu(e, item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/item/${item.ratingKey}`);
        }
      }}
    >
      {/* Poster thumbnail */}
      <div style={styles.rowPosterWrap}>
        <img
          src={thumbUrl(item.thumb)}
          alt={item.title}
          style={styles.rowPoster}
          loading="lazy"
        />
        {watched && (
          <div style={styles.watchedBadge} title="Watched">
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}
      </div>

      {/* Info section */}
      <div style={styles.rowInfo}>
        {/* Title row */}
        <div style={styles.rowTitleRow}>
          <span style={styles.rowTitle}>{item.title}</span>
          {year && <span style={styles.rowYear}>({year})</span>}
          <div style={styles.rowBadges}>
            {audienceRating != null && audienceRating > 0 && (
              <span style={styles.ratingBadge}>
                ★ {audienceRating.toFixed(1)}
              </span>
            )}
            {contentRating && (
              <span style={styles.contentRatingBadge}>{contentRating}</span>
            )}
          </div>
        </div>

        {/* Genre + duration row */}
        {(genres.length > 0 || duration) && (
          <div style={styles.rowMeta}>
            {genres.length > 0 && (
              <span style={styles.genreText}>
                {genres.map((g) => g.tag).join(" · ")}
              </span>
            )}
            {genres.length > 0 && duration && (
              <span style={styles.metaSeparator}>{"·"}</span>
            )}
            {duration && (
              <span style={styles.durationText}>
                {formatDuration(duration)}
              </span>
            )}
          </div>
        )}

        {/* Director row */}
        {directors.length > 0 && (
          <div style={styles.directorRow}>
            <span style={styles.directorLabel}>Director: </span>
            <span style={styles.directorName}>
              {directors.map((d) => d.tag).join(", ")}
            </span>
          </div>
        )}

        {/* Cast row */}
        {topCast.length > 0 && (
          <div style={styles.castRow}>
            {topCast.map((role, i) => (
              <span key={`${role.tag}-${role.role}`} style={styles.castItem}>
                {role.thumb ? (
                  <img
                    src={actorThumbUrl(role.thumb)}
                    alt=""
                    style={styles.castAvatar}
                    loading="lazy"
                    onError={(e) => {
                      // Replace broken image with initials fallback
                      const img = e.currentTarget;
                      const fallback = document.createElement("span");
                      Object.assign(fallback.style, {
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.7rem",
                        fontWeight: "600",
                        color: "var(--text-secondary)",
                        flexShrink: "0",
                      });
                      fallback.textContent = getInitials(role.tag);
                      img.replaceWith(fallback);
                    }}
                  />
                ) : (
                  <span style={styles.castAvatarFallback}>
                    {getInitials(role.tag)}
                  </span>
                )}
                <span
                  style={styles.castLink}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(
                      `/actor/${encodeURIComponent(role.tag)}`,
                      role.thumb ? { state: { thumb: role.thumb } } : undefined
                    );
                  }}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      e.preventDefault();
                      navigate(
                        `/actor/${encodeURIComponent(role.tag)}`,
                        role.thumb
                          ? { state: { thumb: role.thumb } }
                          : undefined
                      );
                    }
                  }}
                >
                  {role.tag}
                </span>
                {role.role && (
                  <span style={styles.castRole}> as {role.role}</span>
                )}
                {i < topCast.length - 1 && (
                  <span style={styles.castSeparator}>{"·"}</span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Synopsis */}
        {summary && (
          <p style={styles.rowSynopsis}>
            {decodeHtmlEntities(summary)}
          </p>
        )}

        {/* Shimmer placeholder while details load */}
        {!detail && isPending && (
          <div style={styles.detailShimmer}>
            <div className="shimmer" style={styles.shimmerLine} />
            <div
              className="shimmer"
              style={{ ...styles.shimmerLine, width: "60%" }}
            />
          </div>
        )}
      </div>

      {/* Play button (desktop only) */}
      {!mobile && (
        <button
          style={styles.rowPlayButton}
          onClick={(e) => {
            e.stopPropagation();
            const handler = getPlayHandler(item);
            if (handler) handler(e);
          }}
          title={`Play ${item.title}`}
          aria-label={`Play ${item.title}`}
        >
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <polygon points="5,3 19,12 5,21" />
          </svg>
        </button>
      )}
    </div>
  );
});

/** Rows beyond the visible window to keep mounted (and detail-fetched)
 *  while scrolling, so data is already warm by the time a row scrolls
 *  fully into view. */
const DETAIL_OVERSCAN = 6;

/** Below this item count, virtualization overhead isn't worth it — mirrors
 *  VirtualizedLibraryGrid's own small-collection bypass. Exported for tests. */
export const ROW_VIRTUALIZE_THRESHOLD = 50;

export interface CollectionItemsListProps {
  items: PlexMediaItem[];
  mobile: boolean;
  navigate: NavigateFunction;
  onContextMenu: (e: React.MouseEvent, item: PlexMediaItem) => void;
  getPlayHandler: (
    item: PlexMediaItem,
  ) => ((e: React.MouseEvent) => void) | undefined;
  thumbUrl: (thumb: string) => string;
  actorThumbUrl: (thumb: string) => string;
}

/**
 * Row-virtualized item list for CollectionDetail (prexu-0szx.6).
 *
 * A full-library collection can be 100s of items, each rendered as a rich
 * row (poster + up to 6 cast images). Mounting them all at once, combined
 * with one getItemMetadata call PER item up front, was the O(n) fan-out +
 * O(n^2) re-render cascade this fixes:
 *  - Only visible (+ overscan) rows are mounted, via @tanstack/react-virtual
 *    — the same virtualizer already used by VirtualizedLibraryGrid.
 *  - Per-item detail queries (useItemDetails) are gated to that same
 *    visible+overscan window instead of the full item list.
 *  - Rows are memoized (ItemRow) and the detail Map has a stable identity
 *    (see useItemDetails), so a row only re-renders when ITS OWN props
 *    actually change.
 */
export function CollectionItemsList({
  items,
  mobile,
  navigate,
  onContextMenu,
  getPlayHandler,
  thumbUrl,
  actorThumbUrl,
}: CollectionItemsListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const getScrollElement = useCallback(
    () => findScrollAncestor(parentRef.current),
    [],
  );
  const shouldVirtualize = items.length >= ROW_VIRTUALIZE_THRESHOLD;

  // Always call the hook (keeps hook order stable as itemCount crosses the
  // threshold) but only feed it real work when virtualizing — mirrors
  // VirtualizedLibraryGrid's `count: virtualize ? rows.length : 0` pattern.
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? items.length : 0,
    getScrollElement,
    estimateSize: () => (mobile ? 280 : 230),
    overscan: DETAIL_OVERSCAN,
  });

  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : [];

  const visibleItems = useMemo(() => {
    if (!shouldVirtualize) return items;
    const result: PlexMediaItem[] = [];
    for (const v of virtualItems) {
      const item = items[v.index];
      if (item) result.push(item);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldVirtualize, virtualItems, items]);

  const { details: detailedItems, pendingKeys } = useItemDetails(visibleItems);

  if (!shouldVirtualize) {
    return (
      <div style={styles.itemsList}>
        {items.map((item) => (
          <ItemRow
            key={item.ratingKey}
            item={item}
            detail={detailedItems.get(item.ratingKey)}
            isPending={pendingKeys.has(item.ratingKey)}
            mobile={mobile}
            thumbUrl={thumbUrl}
            actorThumbUrl={actorThumbUrl}
            navigate={navigate}
            onContextMenu={onContextMenu}
            getPlayHandler={getPlayHandler}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      style={{
        position: "relative",
        width: "100%",
        height: `${virtualizer.getTotalSize()}px`,
      }}
    >
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index];
        if (!item) return null;
        return (
          <div
            key={item.ratingKey}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
              paddingBottom: "6px",
            }}
          >
            <ItemRow
              item={item}
              detail={detailedItems.get(item.ratingKey)}
              isPending={pendingKeys.has(item.ratingKey)}
              mobile={mobile}
              thumbUrl={thumbUrl}
              actorThumbUrl={actorThumbUrl}
              navigate={navigate}
              onContextMenu={onContextMenu}
              getPlayHandler={getPlayHandler}
            />
          </div>
        );
      })}
    </div>
  );
}

function CollectionDetail() {
  const { collectionKey } = useParams<{ collectionKey: string }>();
  const { server } = useAuth();
  const navigate = useNavigate();
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  useScrollRestoration();
  const { openContextMenu, overlays: menuOverlays } = useMediaContextMenu();
  const { getPlayHandler, playOverlay } = usePlayAction();

  const {
    metadata: collection,
    items,
    totalSize,
    isMetadataLoading,
    isItemsLoading,
    isError,
    error,
    refetch,
  } = useDetailItems<PlexCollection, PlexMediaItem>({
    containerKey: collectionKey,
    queryKey: "collection-detail",
    fetchMetadata: (s: PlexServerLike, key) =>
      getItemMetadata<PlexCollection>(s.uri, s.accessToken, key),
    fetchItems: (s, key) => getCollectionItems(s.uri, s.accessToken, key),
  });

  const { hasPlayableItems, playAll, shuffle } = usePlayAll(items);

  useEffect(() => {
    if (collection?.title) document.title = `${collection.title} - Prexu`;
  }, [collection?.title]);

  // Compute watch progress
  const watchedCount = items.filter(isWatched).length;

  // thumbUrl / actorThumbUrl are passed down to the memoized ItemRow list,
  // so they must keep a stable identity (useCallback) — otherwise every
  // CollectionDetail re-render would hand ItemRow "new" function props and
  // defeat its memo. Declared before the early return so hook order stays
  // fixed regardless of `server`.
  const thumbUrl = useCallback(
    (thumb: string) =>
      server ? getImageUrl(server.uri, server.accessToken, thumb, 200, 300) : "",
    [server],
  );
  const actorThumbUrl = useCallback(
    (thumb: string) =>
      server ? getImageUrl(server.uri, server.accessToken, thumb, 80, 80) : "",
    [server],
  );

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);
  const artUrl = (path: string) =>
    getImageUrl(server.uri, server.accessToken, path, 1920, 1080);

  const subtypeLabel =
    collection?.subtype === "show"
      ? "Show Collection"
      : collection?.subtype === "movie"
        ? "Movie Collection"
        : "Collection";

  const addedDate = collection?.addedAt
    ? new Date(collection.addedAt * 1000).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  // Loading state — no metadata yet means we have nothing to frame the page
  // with, so show a centered spinner (matches the original first-load UX).
  if (isMetadataLoading && !collection) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
        </div>
      </div>
    );
  }

  const background = collection ? (
    <>
      <img
        src={
          collection.art
            ? artUrl(collection.art)
            : collection.thumb
              ? posterUrl(collection.thumb)
              : ""
        }
        alt=""
        loading="lazy"
        style={collection.art ? styles.pageBgArt : styles.pageBgArtFallback}
      />
      <div style={styles.pageBgOverlay} />
    </>
  ) : null;

  const header = collection ? (
    <div
      style={{
        ...styles.heroContent,
        paddingTop: mobile ? "2rem" : "4rem",
        paddingBottom: mobile ? "2rem" : "3rem",
        alignItems: "center",
        ...(mobile
          ? { flexDirection: "column", justifyContent: "center" }
          : {}),
      }}
    >
      {/* Collection poster */}
      {collection.thumb && (
        <img
          src={posterUrl(collection.thumb)}
          alt={collection.title}
          style={{
            ...styles.heroPoster,
            width: mobile ? "160px" : bp === "large" ? "280px" : "240px",
            height: "auto",
            ...(mobile ? { alignSelf: "center" } : {}),
          }}
        />
      )}

      {/* Info section */}
      <div
        style={{
          ...styles.heroInfo,
          ...(mobile ? { alignItems: "center" } : {}),
        }}
      >
        <h1
          style={{
            ...styles.heroTitle,
            fontSize: mobile
              ? "1.6rem"
              : bp === "large"
                ? "2.8rem"
                : "2.4rem",
            ...(mobile ? { textAlign: "center" as const } : {}),
          }}
        >
          {collection.title}
        </h1>

        {/* Meta row */}
        <div
          style={{
            ...styles.metaRow,
            ...(mobile ? { justifyContent: "center" } : {}),
          }}
        >
          <span style={styles.subtypeBadge}>{subtypeLabel}</span>
          <span>
            {totalSize} item{totalSize !== 1 ? "s" : ""}
          </span>
          {totalSize > 0 && (
            <span>
              {watchedCount} of {totalSize} watched
            </span>
          )}
        </div>

        {/* Watch progress bar */}
        {totalSize > 0 && <ProgressBar value={watchedCount / totalSize} />}

        {/* Play All / Shuffle buttons */}
        {hasPlayableItems && items.length > 0 && (
          <div
            style={{
              ...styles.playActions,
              ...(mobile ? { justifyContent: "center" } : {}),
            }}
          >
            <button onClick={playAll} style={styles.playAllButton}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
              Play All
            </button>
            <button onClick={shuffle} style={styles.shuffleButton}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8" />
                <line x1={4} y1={20} x2={21} y2={3} />
                <polyline points="21 16 21 21 16 21" />
                <line x1={15} y1={15} x2={21} y2={21} />
                <line x1={4} y1={4} x2={9} y2={9} />
              </svg>
              Shuffle
            </button>
          </div>
        )}

        {/* Summary */}
        {collection.summary && (
          <p
            style={{
              ...styles.summary,
              ...(mobile ? { textAlign: "center" as const } : {}),
            }}
          >
            {decodeHtmlEntities(collection.summary)}
          </p>
        )}

        {/* Added date */}
        {addedDate && <span style={styles.addedDate}>Added {addedDate}</span>}
      </div>
    </div>
  ) : null;

  return (
    <DetailPageShell
      style={styles.container}
      background={background}
      header={header}
      isError={isError}
      errorSlot={
        <ErrorState message={error ?? ""} onRetry={() => refetch()} />
      }
      isLoading={isItemsLoading}
      loadingSlot={
        collection ? (
          <div style={styles.itemsSection}>
            <LoadingGrid count={12} />
          </div>
        ) : null
      }
      isEmpty={items.length === 0}
      emptySlot={
        <EmptyState
          icon={
            <svg
              width={48}
              height={48}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <rect x={3} y={3} width={7} height={7} rx={1} />
              <rect x={14} y={3} width={7} height={7} rx={1} />
              <rect x={3} y={14} width={7} height={7} rx={1} />
              <rect x={14} y={14} width={7} height={7} rx={1} />
            </svg>
          }
          title="Empty collection"
          subtitle="This collection doesn't have any items yet."
          action={{
            label: "Back to Collections",
            onClick: () => navigate(-1),
          }}
        />
      }
      overlays={
        <>
          {menuOverlays}
          {playOverlay}
        </>
      }
    >
      <div style={styles.itemsSection}>
        <SectionHeader title="In This Collection" count={totalSize} />
        <CollectionItemsList
          items={items}
          mobile={mobile}
          navigate={navigate}
          onContextMenu={openContextMenu}
          getPlayHandler={getPlayHandler}
          thumbUrl={thumbUrl}
          actorThumbUrl={actorThumbUrl}
        />
      </div>
    </DetailPageShell>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // Spread shared hero/background styles
  ...detailStyles,
  // Page-specific styles
  container: {
    position: "relative",
    paddingBottom: "2rem",
    overflow: "hidden",
  },
  loadingContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4rem",
  },
  spinner: {
    width: "32px",
    height: "32px",
    border: "3px solid var(--border)",
    borderTopColor: "var(--accent)",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  subtypeBadge: {
    background: "rgba(255,255,255,0.1)",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    padding: "3px 10px",
    borderRadius: "14px",
  },
  summary: {
    fontSize: "0.95rem",
    color: "var(--text-secondary)",
    lineHeight: 1.6,
    maxWidth: "800px",
    marginTop: "0.25rem",
  },
  addedDate: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    opacity: 0.7,
  },
  playActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginTop: "0.5rem",
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
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.1)",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    fontWeight: 500,
    cursor: "pointer",
  },
  // Items section
  itemsSection: {
    position: "relative",
    zIndex: 1,
    padding: "0 2.5rem",
  },
  itemsList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  // Item row
  itemRow: {
    display: "flex",
    alignItems: "center",
    gap: "1.25rem",
    padding: "1rem 1.25rem",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "background 0.15s ease",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid transparent",
  },
  itemRowMobile: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "0.75rem",
    padding: "1rem 0.75rem",
  },
  // Poster thumbnail
  rowPosterWrap: {
    position: "relative",
    flexShrink: 0,
  },
  rowPoster: {
    width: "130px",
    height: "195px",
    objectFit: "cover",
    borderRadius: "6px",
    background: "var(--bg-secondary)",
  },
  watchedBadge: {
    position: "absolute",
    bottom: "-4px",
    right: "-4px",
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    background: "var(--accent)",
    color: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  // Info column
  rowInfo: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  rowTitleRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  rowTitle: {
    fontSize: "1.25rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  rowYear: {
    fontSize: "1rem",
    color: "var(--text-secondary)",
  },
  rowBadges: {
    display: "flex",
    gap: "0.5rem",
    marginLeft: "auto",
    flexShrink: 0,
  },
  ratingBadge: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "var(--accent)",
  },
  contentRatingBadge: {
    fontSize: "0.8rem",
    fontWeight: 500,
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "3px",
    padding: "2px 6px",
    lineHeight: 1.4,
  },
  // Genre + duration
  rowMeta: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "1rem",
    color: "var(--text-secondary)",
    flexWrap: "wrap",
  },
  genreText: {
    color: "var(--text-secondary)",
  },
  metaSeparator: {
    opacity: 0.5,
  },
  durationText: {
    color: "var(--text-secondary)",
  },
  // Director
  directorRow: {
    fontSize: "1rem",
    color: "var(--text-secondary)",
  },
  directorLabel: {
    opacity: 0.7,
  },
  directorName: {
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  // Cast
  castRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flexWrap: "wrap",
    marginTop: "0.5rem",
  },
  castItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "1rem",
    color: "var(--text-secondary)",
  },
  castAvatar: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  castAvatarFallback: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  castLink: {
    color: "var(--text-primary)",
    fontWeight: 500,
    fontSize: "1.05rem",
    cursor: "pointer",
    transition: "color 0.15s",
  },
  castRole: {
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    opacity: 0.8,
  },
  castSeparator: {
    color: "var(--text-secondary)",
    opacity: 0.4,
    margin: "0 0.25rem",
  },
  // Synopsis
  rowSynopsis: {
    fontSize: "1rem",
    color: "var(--text-secondary)",
    opacity: 0.8,
    lineHeight: 1.6,
    marginTop: "0.25rem",
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  // Detail shimmer placeholder
  detailShimmer: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    marginTop: "0.2rem",
  },
  shimmerLine: {
    height: "12px",
    width: "80%",
    borderRadius: "4px",
    background: "var(--bg-secondary)",
  },
  // Play button
  rowPlayButton: {
    flexShrink: 0,
    width: "42px",
    height: "42px",
    borderRadius: "50%",
    border: "none",
    background: "var(--accent)",
    color: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "transform 0.15s, opacity 0.15s",
    opacity: 0.8,
  },
};

export default CollectionDetail;
