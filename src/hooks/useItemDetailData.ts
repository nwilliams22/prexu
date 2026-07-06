import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import { usePreferences } from "./usePreferences";
import {
  getItemMetadata,
  getItemChildren,
  getRelatedItems,
  getExtras,
  getMediaByActor,
  getCollections,
  getCollectionItems,
} from "../services/plex-library";
import { useLibrary } from "./useLibrary";
import { cacheGetStale, cacheSet } from "../services/api-cache";
import { logger } from "../services/logger";
import type {
  PlexMediaItem,
  PlexMovie,
  PlexShow,
  PlexSeason,
  PlexEpisode,
  PlexRole,
  PlexCollection,
} from "../types/library";

export interface ItemDetailData {
  item: PlexMediaItem | null;
  seasons: PlexSeason[];
  episodes: PlexEpisode[];
  isLoading: boolean;
  error: string | null;
  parentShow: PlexShow | null;
  siblingSeasons: PlexSeason[];
  siblingEpisodes: PlexEpisode[];
  related: PlexMediaItem[];
  extras: PlexMediaItem[];
  moreWithActors: { name: string; items: PlexMediaItem[] }[];
  collectionItems: { collection: PlexCollection; items: PlexMediaItem[] } | null;
  showFixMatch: boolean;
  setShowFixMatch: (v: boolean) => void;
  refreshItem: () => void;
  setItem: React.Dispatch<React.SetStateAction<PlexMediaItem | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setEpisodes: React.Dispatch<React.SetStateAction<PlexEpisode[]>>;
}

/** Minimal server shape needed to fetch/prefetch detail data. */
export interface DetailServerLike {
  uri: string;
  accessToken: string;
}

/** Everything the primary (metadata + children) fetch effect produces, cached as one bundle keyed by ratingKey. */
interface DetailCachePayload {
  item: PlexMediaItem;
  seasons: PlexSeason[];
  episodes: PlexEpisode[];
  parentShow: PlexShow | null;
  siblingSeasons: PlexSeason[];
  siblingEpisodes: PlexEpisode[];
}

/**
 * Cache TTL for the item-detail bundle. 30s matches useDetailItems' staleTime
 * convention — long enough that back/forward navigation between recently
 * viewed items is instant, short enough that watched-state/metadata edits
 * show up promptly.
 */
const DETAIL_CACHE_TTL = 30_000;

function detailCacheKey(serverUri: string, ratingKey: string): string {
  return `item-detail:${serverUri}:${ratingKey}`;
}

/**
 * Fetch an item's metadata plus whatever children/parent/siblings its type
 * needs. Pure data fetch — no state, no navigation side effects — so it can
 * be shared between the hook's fetch effect and the standalone prefetch
 * entry point below (for prexu-0szx.15's hover-intent prefetch).
 */
async function fetchDetailBundle(
  server: DetailServerLike,
  ratingKey: string,
  signal?: AbortSignal,
): Promise<DetailCachePayload> {
  const metadata = await getItemMetadata<PlexMediaItem>(
    server.uri,
    server.accessToken,
    ratingKey,
    signal,
  );

  let seasons: PlexSeason[] = [];
  let episodes: PlexEpisode[] = [];
  let parentShow: PlexShow | null = null;
  let siblingSeasons: PlexSeason[] = [];
  let siblingEpisodes: PlexEpisode[] = [];

  if (metadata.type === "show") {
    seasons = await getItemChildren<PlexSeason>(
      server.uri,
      server.accessToken,
      ratingKey,
      signal,
    );
  } else if (metadata.type === "season") {
    const season = metadata as PlexSeason;
    const [epList, showMeta, siblingList] = await Promise.all([
      getItemChildren<PlexEpisode>(server.uri, server.accessToken, ratingKey, signal),
      getItemMetadata<PlexShow>(server.uri, server.accessToken, season.parentRatingKey, signal),
      getItemChildren<PlexSeason>(server.uri, server.accessToken, season.parentRatingKey, signal),
    ]);
    episodes = epList;
    parentShow = showMeta;
    siblingSeasons = siblingList;
  } else if (metadata.type === "episode") {
    const episode = metadata as PlexEpisode;
    siblingEpisodes = await getItemChildren<PlexEpisode>(
      server.uri,
      server.accessToken,
      episode.parentRatingKey,
      signal,
    );
  }

  return { item: metadata, seasons, episodes, parentShow, siblingSeasons, siblingEpisodes };
}

/** Top-level fields of a detail bundle, diffed independently — see {@link diffBundleKeys}. */
const BUNDLE_KEYS = [
  "item",
  "seasons",
  "episodes",
  "parentShow",
  "siblingSeasons",
  "siblingEpisodes",
] as const;
type BundleKey = (typeof BUNDLE_KEYS)[number];

/** Deep-equal via JSON serialization — fine for these small, JSON-shaped payloads. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Structural equality for two detail bundles. Used to decide whether a
 * background revalidation is a *complete* no-op (skip re-apply entirely) —
 * skipping a no-op re-apply avoids handing out a fresh `item`/array object
 * identity on every same-item revalidation, which otherwise cascades into
 * the related/extras/actors and collection effects re-firing for no reason.
 *
 * In practice this rarely returns true for an item that's being (or was
 * just) watched. Plex writes `viewOffset` on every timeline tick during
 * active playback (roughly every 10s, from any session/device) and bumps
 * `viewCount`/`lastViewedAt`/`viewedLeafCount` the instant a play session
 * crosses the "watched" threshold — exactly the "user had just watched
 * something" case this bug report describes. Those fields live on `item`
 * directly (movie/episode) and inside `seasons`/`episodes`/`siblingEpisodes`
 * (e.g. a sibling episode's own watch state, or a season's
 * `viewedLeafCount`), so a full-bundle comparison is defeated by any one of
 * them changing anywhere in the bundle — even when the change is invisible
 * on this page (a different episode's viewOffset ticking while this show's
 * page happens to be open).
 *
 * Rather than trying to special-case which fields are "safe" to ignore (and
 * risk silently dropping a real watch-state update the user needs to see —
 * the resume time, the watched checkmark), the fetch handler below applies
 * updates per top-level bundle key (see {@link diffBundleKeys}) instead of
 * replacing all six pieces of state whenever any field anywhere differs.
 * That keeps the blast radius of a watch-state-only change limited to
 * `item` (the hero re-renders) instead of also replacing seasons/episodes/
 * siblings with fresh-but-content-identical arrays, which previously forced
 * the whole page (hero + season grid + episode list + cast) through one
 * large simultaneous re-render for a one-field change.
 */
function detailBundlesEqual(a: DetailCachePayload, b: DetailCachePayload): boolean {
  if (a === b) return true;
  return BUNDLE_KEYS.every((k) => deepEqual(a[k], b[k]));
}

/** Which top-level bundle fields differ between a cached bundle and a revalidation. */
function diffBundleKeys(a: DetailCachePayload, b: DetailCachePayload): BundleKey[] {
  return BUNDLE_KEYS.filter((k) => !deepEqual(a[k], b[k]));
}

/**
 * Which fields on the item itself differ — narrows an `item` bundle-key
 * diff down to the actual field(s) that jittered (e.g. `viewOffset`,
 * `viewCount`, `Genre` if child-array ordering shifted). Logged at debug so
 * a real repro tells us definitively which field is responsible.
 */
function diffItemFields(a: PlexMediaItem, b: PlexMediaItem): string[] {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  const diffs: string[] = [];
  for (const k of keys) {
    if (!deepEqual((a as unknown as Record<string, unknown>)[k], (b as unknown as Record<string, unknown>)[k])) {
      diffs.push(k);
    }
  }
  return diffs;
}

/**
 * Warm the item-detail cache for a ratingKey without mounting the detail
 * page — the entry point for prexu-0szx.15's hover-intent prefetch from
 * PosterCard. No-ops if a fresh (non-stale) entry is already cached.
 */
export async function warmItemDetailCache(
  server: DetailServerLike,
  ratingKey: string,
): Promise<void> {
  const key = detailCacheKey(server.uri, ratingKey);
  const existing = cacheGetStale<DetailCachePayload>(key);
  if (existing && !existing.stale) {
    logger.debug("detail", "warmItemDetailCache: already warm, skipping", { ratingKey });
    return;
  }
  try {
    const bundle = await fetchDetailBundle(server, ratingKey);
    cacheSet(key, bundle, DETAIL_CACHE_TTL);
    logger.debug("detail", "warmItemDetailCache: prefetched", { ratingKey });
  } catch (err) {
    logger.debug("detail", "warmItemDetailCache: prefetch failed (non-fatal)", {
      ratingKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function useItemDetailData(): ItemDetailData {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const { server } = useAuth();
  const { preferences } = usePreferences();
  const { sections } = useLibrary();
  const navigate = useNavigate();

  const [item, setItem] = useState<PlexMediaItem | null>(null);
  const [seasons, setSeasons] = useState<PlexSeason[]>([]);
  const [episodes, setEpisodes] = useState<PlexEpisode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [parentShow, setParentShow] = useState<PlexShow | null>(null);
  const [siblingSeasons, setSiblingSeasons] = useState<PlexSeason[]>([]);
  const [siblingEpisodes, setSiblingEpisodes] = useState<PlexEpisode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [related, setRelated] = useState<PlexMediaItem[]>([]);
  const [extras, setExtras] = useState<PlexMediaItem[]>([]);
  const [moreWithActors, setMoreWithActors] = useState<
    { name: string; items: PlexMediaItem[] }[]
  >([]);
  const [collectionItems, setCollectionItems] = useState<{
    collection: PlexCollection;
    items: PlexMediaItem[];
  } | null>(null);
  const [showFixMatch, setShowFixMatch] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Set by refreshItem() so the next effect run treats a fresh (non-stale)
  // cache entry as stale anyway — forces a real network revalidation without
  // requiring cacheInvalidate (which would blank the page back to a skeleton).
  const forceRevalidateRef = useRef(false);
  const refreshItem = useCallback(() => {
    forceRevalidateRef.current = true;
    setRefreshKey((k) => k + 1);
  }, []);
  // Tracks the ratingKey the shelf state (related/extras/actors/collection)
  // was last populated for, so the primary effect can tell a same-item
  // revalidation (cache-serve, background refresh, manual refreshItem())
  // apart from an actual navigation to a different item — only the latter
  // should clear the shelves.
  const previousRatingKeyRef = useRef<string | undefined>(undefined);

  // Fetch item metadata + children — cached (stale-while-revalidate) and abortable.
  useEffect(() => {
    if (!server || !ratingKey) return;

    const controller = new AbortController();
    const key = detailCacheKey(server.uri, ratingKey);
    const forceRevalidate = forceRevalidateRef.current;
    forceRevalidateRef.current = false;

    const isDifferentItem = previousRatingKeyRef.current !== ratingKey;
    previousRatingKeyRef.current = ratingKey;

    // Secondary "shelf" state (related/extras/actors/collection) isn't part
    // of the cached bundle above. Only clear it when navigating to a
    // DIFFERENT item — a same-item revalidation (stale-while-revalidate or a
    // manual refreshItem()) must leave already-loaded shelves in place so
    // the page doesn't visibly blank-then-reload while showing the same
    // item. The effects below repopulate them, keyed on ratingKey.
    if (isDifferentItem) {
      logger.debug("detail", "useItemDetailData: navigated to a different item, clearing shelves", {
        ratingKey,
      });
      setRelated([]);
      setExtras([]);
      setMoreWithActors([]);
      setCollectionItems(null);
    }

    // `onlyKeys`, when passed, restricts the apply to the bundle fields that
    // actually changed (see diffBundleKeys below) instead of unconditionally
    // replacing all six pieces of state. A watch-state-only revalidation
    // (viewOffset ticking, a watched checkmark flipping) then only touches
    // `item` — seasons/episodes/siblings keep their previous object
    // identity, so React has nothing new to reconcile for the season grid,
    // episode list, or cast sections, and the visible update is limited to
    // the hero section that actually changed instead of reading as a
    // full-page refresh.
    const applyBundle = (bundle: DetailCachePayload, onlyKeys?: readonly BundleKey[]): boolean => {
      if (
        bundle.item.type === "show" &&
        bundle.seasons.length === 1 &&
        preferences.appearance.skipSingleSeason
      ) {
        navigate(`/item/${bundle.seasons[0]!.ratingKey}`, { replace: true });
        return false;
      }
      const shouldApply = (k: BundleKey) => !onlyKeys || onlyKeys.includes(k);
      if (shouldApply("item")) setItem(bundle.item);
      if (shouldApply("seasons")) setSeasons(bundle.seasons);
      if (shouldApply("episodes")) setEpisodes(bundle.episodes);
      if (shouldApply("parentShow")) setParentShow(bundle.parentShow);
      if (shouldApply("siblingSeasons")) setSiblingSeasons(bundle.siblingSeasons);
      if (shouldApply("siblingEpisodes")) setSiblingEpisodes(bundle.siblingEpisodes);
      return true;
    };

    const cached = cacheGetStale<DetailCachePayload>(key);

    if (cached) {
      // Stale-while-revalidate: render the cached item immediately — no
      // blank/spinner flash — instead of a full cold reload.
      logger.debug("detail", "useItemDetailData: serving cached bundle", {
        ratingKey,
        stale: cached.stale,
        forceRevalidate,
      });
      const applied = applyBundle(cached.data);
      if (!applied) {
        // Redirected away (single-season skip) — nothing more to do.
        return () => controller.abort();
      }
      setError(null);
      setIsLoading(false);
      if (!cached.stale && !forceRevalidate) {
        // Fresh enough — skip the network entirely.
        return () => controller.abort();
      }
    } else {
      // True cold load — nothing to show yet.
      setItem(null);
      setIsLoading(true);
      const mainEl = document.querySelector("main");
      if (mainEl) mainEl.scrollTop = 0;
      else window.scrollTo(0, 0);
      setError(null);
      setSeasons([]);
      setEpisodes([]);
      setSiblingEpisodes([]);
      setParentShow(null);
      setSiblingSeasons([]);
    }

    logger.debug("api", "useItemDetailData: fetching detail bundle", {
      ratingKey,
      revalidate: Boolean(cached),
    });

    fetchDetailBundle(server, ratingKey, controller.signal)
      .then((bundle) => {
        if (controller.signal.aborted) return;
        cacheSet(key, bundle, DETAIL_CACHE_TTL);
        if (cached) {
          if (detailBundlesEqual(cached.data, bundle)) {
            // Revalidation confirmed nothing changed — skip re-applying so we
            // don't hand out a new `item` object identity for no reason (that
            // identity churn is what previously re-fired the shelf/collection
            // effects and produced a visible refresh flash).
            logger.debug("detail", "useItemDetailData: revalidation unchanged, skipping re-apply", {
              ratingKey,
            });
            return;
          }
          // Not a full no-op — log exactly which bundle field(s) (and, for
          // `item`, which item field(s)) jittered, then only apply those
          // fields instead of replacing the whole bundle. See
          // detailBundlesEqual's doc comment for why a full-bundle equality
          // check alone isn't enough to keep this silent.
          const changedKeys = diffBundleKeys(cached.data, bundle);
          const itemFieldDiffs = changedKeys.includes("item")
            ? diffItemFields(cached.data.item, bundle.item)
            : [];
          logger.debug(
            "detail",
            "useItemDetailData: revalidation changed, applying only the changed bundle fields",
            { ratingKey, changedKeys, itemFieldDiffs },
          );
          applyBundle(bundle, changedKeys);
          return;
        }
        applyBundle(bundle);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (!cached) {
          // Only surface a page-level error on a true cold-load failure — a
          // background revalidation failure just keeps showing stale data.
          setError(err instanceof Error ? err.message : "Failed to load item");
        } else {
          logger.warn("detail", "background revalidation failed, keeping stale item detail", {
            ratingKey,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [server, ratingKey, refreshKey, preferences.appearance.skipSingleSeason, navigate]);

  // Update page title when item loads
  useEffect(() => {
    if (item) document.title = `${item.title} - Prexu`;
  }, [item]);

  // Fetch related + extras + "more with actor" (non-critical)
  useEffect(() => {
    if (!server || !ratingKey || !item) return;
    if (item.type !== "movie" && item.type !== "show" && item.type !== "episode") return;
    const controller = new AbortController();

    const roles: PlexRole[] =
      (item as PlexMovie | PlexShow | PlexEpisode).Role ?? [];
    const leadActors = roles.slice(0, 2).map((r) => r.tag);

    const actorSearches = leadActors.map((name) =>
      getMediaByActor(server.uri, server.accessToken, name, controller.signal)
        .then((allItems) => {
          const items = allItems.filter((m) => m.ratingKey !== ratingKey);
          return { name, items };
        })
        .catch(() => ({ name, items: [] as PlexMediaItem[] }))
    );

    const relatedPromise = getRelatedItems(
      server.uri,
      server.accessToken,
      ratingKey,
      item.type,
      controller.signal,
    );

    Promise.allSettled([
      relatedPromise,
      getExtras(server.uri, server.accessToken, ratingKey, controller.signal),
      Promise.all(actorSearches),
    ]).then(([relResult, extResult, actorResult]) => {
      if (controller.signal.aborted) return;
      if (relResult.status === "fulfilled") setRelated(relResult.value);
      if (extResult.status === "fulfilled") setExtras(extResult.value);
      if (actorResult.status === "fulfilled") {
        setMoreWithActors(
          actorResult.value.filter((a) => a.items.length > 0)
        );
      }
    });

    return () => {
      controller.abort();
    };
    // Keyed on item?.ratingKey (stable across a same-item revalidation) —
    // not on `item` itself — so a background refresh that produces a new
    // `item` object identity (same underlying data) doesn't abort in-flight
    // shelf fetches and restart them from scratch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, ratingKey, item?.ratingKey]);

  // Fetch collection items if this movie belongs to a collection
  useEffect(() => {
    if (!server || !item || item.type !== "movie") return;
    const movie = item as PlexMovie;
    const collectionTags = movie.Collection;
    if (!collectionTags || collectionTags.length === 0) return;

    const controller = new AbortController();
    const collectionName = collectionTags[0]!.tag;

    // Search all movie sections for the matching collection
    const movieSections = sections.filter((s) => s.type === "movie");

    (async () => {
      for (const section of movieSections) {
        try {
          const colls = await getCollections(
            server.uri,
            server.accessToken,
            section.key,
            controller.signal,
          );
          const match = colls.find((c) => c.title === collectionName);
          if (match && !controller.signal.aborted) {
            const result = await getCollectionItems(
              server.uri,
              server.accessToken,
              match.ratingKey,
              { signal: controller.signal },
            );
            if (!controller.signal.aborted) {
              // Exclude the current movie from the list
              const otherItems = result.items.filter(
                (i) => i.ratingKey !== ratingKey
              );
              if (otherItems.length > 0) {
                setCollectionItems({ collection: match, items: otherItems });
              }
            }
            return;
          }
        } catch {
          // Continue searching other sections
        }
      }
    })();

    return () => {
      controller.abort();
    };
    // Same reasoning as the related/extras/actors effect above: key on
    // item?.ratingKey, not `item`, so same-item revalidation doesn't restart
    // the collection lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, item?.ratingKey, ratingKey, sections]);

  return {
    item,
    seasons,
    episodes,
    isLoading,
    error,
    parentShow,
    siblingSeasons,
    siblingEpisodes,
    related,
    extras,
    moreWithActors,
    collectionItems,
    showFixMatch,
    setShowFixMatch,
    refreshItem,
    setItem,
    setIsLoading,
    setEpisodes,
  };
}
