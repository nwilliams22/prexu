/**
 * Module-level cache invalidation listeners that persist across component
 * mount/unmount cycles. Ensures dashboard cache stays fresh even when the
 * Dashboard component is unmounted (e.g., while the Player overlay is active).
 */

import { cacheInvalidateWhere, cacheUpdateWhere } from "./api-cache";
import { onWatchStateChangedDetail } from "./watch-state-events";
import { logger } from "./logger";
import type { PlexMediaItem } from "../types/library";

/**
 * Delay between the watch-state-changed event and the deck cache
 * invalidation it triggers (prexu-ix52).
 *
 * PMS acknowledges a `/:/timeline?state=stopped` write (HTTP 200) before it
 * has necessarily finished updating the item's resume marker / onDeck
 * listing — that ingestion is a separate, asynchronous step server-side.
 * Invalidating (and thus refetching) `/library/onDeck` immediately after the
 * ack risks the refetch racing that ingestion: the response PMS builds can
 * still reflect the PRE-stop state, baking a stale viewOffset into a
 * fresh-looking 60-minute cache entry. ~1.8s gives PMS time to finish
 * ingesting before we force a refetch, while staying well under what a user
 * would perceive as a delayed dashboard update.
 */
export const DECK_INVALIDATION_DELAY_MS = 1800;

/**
 * Initialize cache invalidation listeners. Call once at app startup.
 * Sets up a persistent listener that invalidates the onDeck cache whenever
 * playback watch state changes (resume offset cleared or recorded).
 */
export function initializeCacheInvalidators(): void {
  // When playback stops and watch state is updated on the server, invalidate
  // all onDeck cache entries so the Dashboard refetches when it remounts.
  // Pattern: dashboard:{serverUri}:deck
  // Delayed by DECK_INVALIDATION_DELAY_MS — see doc comment above — so the
  // forced refetch doesn't race PMS's own async ingestion of the stop write.
  //
  // Item-detail cache entries (prexu-lz4t) are invalidated on the SAME
  // event, but WITHOUT the delay — see invalidateItemDetailCaches' doc
  // comment for why that asymmetry is correct rather than an oversight.
  const unsubscribe = onWatchStateChangedDetail(({ ratingKey, viewOffsetMs, reset }) => {
    // prexu-8nl0: the event now (optionally) carries the exact viewOffset the
    // player just wrote to the server. When it does, PATCH the caches with
    // that known-correct value BEFORE any invalidation runs, instead of
    // waiting on a refetch — any refetch (this module's own delayed one, or
    // useDashboard's own immediate on-event refetch, or a hover-prefetch of
    // the item-detail bundle) can still land before PMS finishes ingesting
    // the write and re-cache the PRE-stop value. See patchDeckCaches /
    // patchItemDetailCache / applyOffsetFloors below for the full mechanism.
    const hasOffset = ratingKey !== undefined && viewOffsetMs !== undefined;
    if (hasOffset) {
      registerOffsetFloor(ratingKey, viewOffsetMs, Boolean(reset));
      const deckEntriesPatched = patchDeckCaches(ratingKey, viewOffsetMs);
      const detailPatched = patchItemDetailCache(ratingKey, viewOffsetMs);
      logger.debug("playback", "patch applied", {
        ratingKey,
        offset: viewOffsetMs,
        entriesPatched: deckEntriesPatched + (detailPatched ? 1 : 0),
      });
    }

    logger.debug("api", "deck cache invalidation scheduled", {
      delayMs: DECK_INVALIDATION_DELAY_MS,
    });
    setTimeout(() => {
      invalidateDeckCaches();
    }, DECK_INVALIDATION_DELAY_MS);

    if (hasOffset) {
      // The item-detail entry (if any) was already patched in place above
      // with correct, fresh data — deleting it here (the old unconditional
      // invalidation) would just erase that patch and force an unguarded
      // refetch that could reintroduce the exact race this is fixing. Skip
      // it for this key; the delayed deck invalidation above still runs as a
      // belt-and-braces resync for anything the offset-only patch can't
      // reach (e.g. an item entering/leaving the deck).
      logger.debug("detail", "item-detail cache patched, skipping immediate invalidation", {
        ratingKey,
      });
    } else {
      invalidateItemDetailCaches(ratingKey);
    }
  });

  // Keep listener alive for the lifetime of the app (never unsubscribe)
  // by letting the returned unsubscribe function fall out of scope.
  void unsubscribe;
}

/**
 * Invalidate all onDeck cache entries across all servers.
 * Called when playback watch state changes to ensure Dashboard
 * refetches fresh data on next mount.
 */
export function invalidateDeckCaches(): void {
  // Match keys with pattern: dashboard:...:deck
  // We invalidate all server URIs since we don't track which one was playing.
  //
  // This is safe because:
  // 1. Watch state only changes when the user actually plays on this app
  // 2. Invalidating forces a refetch, which is exactly what we want
  // 3. If Dashboard isn't mounted, there's no refetch cost
  cacheInvalidateWhere(
    (key) => key.startsWith("dashboard:") && key.endsWith(":deck"),
  );
  logger.debug("api", "invalidated deck caches on watch state change");
}

/**
 * Invalidate item-detail cache entries (`item-detail:{serverUri}:{ratingKey}`,
 * see useItemDetailData.ts) affected by a watch-state change (prexu-lz4t).
 *
 * Background: the item-detail bundle is a separate 30s-TTL cache from the
 * onDeck "deck" cache above. Before this fix, only `dashboard:*:deck` was
 * invalidated on watch-state change, so the item-detail bundle (and thus the
 * "Resume from X:XX" label on the detail page hero, and warmItemDetailCache's
 * hover-prefetch) kept serving the pre-playback viewOffset for up to 30s (or
 * indefinitely, if re-warmed by a hover before the TTL expired, since a warm
 * non-stale entry short-circuits the refetch entirely).
 *
 * Timing — no delay, unlike invalidateDeckCaches: the onDeck delay
 * (DECK_INVALIDATION_DELAY_MS) exists because PMS acknowledges the stop
 * write before it has necessarily finished the SEPARATE, async server-side
 * step of rebuilding the onDeck listing. Fetching a single item's own
 * metadata (what the item-detail bundle's primary fetch does) reads the same
 * record the write just updated, with no separate rebuild step in between —
 * and useTimelineReporting only fires this event from inside the write's
 * own `.then()`, i.e. after the server has already acknowledged it. So an
 * immediate invalidation here does not race the write the way the deck
 * refetch would.
 *
 * Targeting — precise when possible, broad when not:
 * - `ratingKey` known: invalidate only `item-detail:*:{ratingKey}` (every
 *   server, since — like the deck invalidation above — we don't track which
 *   server was playing). Entries for unrelated items are left untouched.
 * - `ratingKey` unknown: invalidate every `item-detail:*` entry. Cheap
 *   correctness over precision — these are 30s-TTL, in-memory-only entries,
 *   so over-invalidating just costs a few extra refetches, never a stale
 *   label.
 *
 * Known gap — parent/season/show rollups: an episode's watch state also
 * changes the `viewedLeafCount` embedded in its season's and show's OWN
 * item-detail bundles (see the `seasons`/`episodes`/`siblingEpisodes` shape
 * in useItemDetailData's DetailCachePayload) — bundles keyed by the season's
 * or show's ratingKey, not the episode's. This event only carries the
 * episode's own ratingKey (that's all useTimelineReporting has cheaply on
 * hand — no parentRatingKey/grandparentRatingKey without an extra metadata
 * fetch on the hot stop path), so precise invalidation cannot reach those
 * parent bundles. This is accepted for now: the visible symptom is a stale
 * viewed-count/checkmark on a season/show page (not a wrong resume time —
 * the bug this fix targets), and it self-heals within one DETAIL_CACHE_TTL
 * window regardless. A future fix could either widen the event payload to
 * include the parent chain, or fall back to the broad sweep whenever the
 * changed item's type can't be cheaply proven to be a movie/top-level show.
 */
function invalidateItemDetailCaches(ratingKey?: string): void {
  if (!ratingKey) {
    cacheInvalidateWhere((key) => key.startsWith("item-detail:"));
    logger.debug(
      "detail",
      "invalidated all item-detail caches on watch state change (no ratingKey on event)",
    );
    return;
  }
  cacheInvalidateWhere(
    (key) => key.startsWith("item-detail:") && key.endsWith(`:${ratingKey}`),
  );
  logger.debug("detail", "invalidated item-detail cache on watch state change", {
    ratingKey,
  });
}

// ── Optimistic offset patch (prexu-8nl0) ──
//
// PR #69's investigation showed the render path itself is correct (PosterCard
// repaints on a viewOffset change; the resume popover reads live data) — the
// remaining staleness is a server-timing race: after a verified stop write,
// ANY refetch (this module's delayed deck invalidation, useDashboard's own
// immediate on-event refetch, or a hover-prefetch of the item-detail bundle)
// can land before PMS finishes ingesting the write and re-cache the PRE-stop
// viewOffset — for up to the deck's 60-minute TTL or the item-detail bundle's
// 30s TTL. Waiting out server timing more (a longer delay, more invalidation)
// can only ever narrow that window, not close it.
//
// The client already knows the final offset at stop time — it's the exact
// value just beaconed to the server. So instead of depending on a refetch to
// eventually reflect it, the functions below patch it directly into the
// caches the moment the event fires, and a short-lived "floor" registry
// protects against an in-flight (or immediately-triggered) refetch that
// resolves with stale data before the patch's effective window would
// otherwise be overwritten by it.

/**
 * Patch every cached deck entry's matching item (by ratingKey) with a
 * known-correct viewOffset, in place. Entries without that ratingKey, and
 * entries for unrelated items within a matching entry, are left untouched.
 * Returns how many deck cache entries (servers) actually contained a match.
 */
function patchDeckCaches(ratingKey: string, viewOffsetMs: number): number {
  return cacheUpdateWhere<PlexMediaItem[]>(
    (key) => key.startsWith("dashboard:") && key.endsWith(":deck"),
    (items) => {
      const idx = items.findIndex((item) => item.ratingKey === ratingKey);
      if (idx === -1) return undefined;
      const next = items.slice();
      next[idx] = { ...next[idx]!, viewOffset: viewOffsetMs };
      return next;
    },
  );
}

/**
 * Minimal shape of an item-detail cache bundle (see useItemDetailData's
 * private `DetailCachePayload`) — only the field this patch touches. Kept
 * local rather than importing the (unexported) real type: useItemDetailData.ts
 * is owned by another workstream and this module only ever needs to read/
 * write `item.viewOffset` on the cached bundle.
 */
interface DetailBundleLike {
  item: PlexMediaItem;
  [key: string]: unknown;
}

/**
 * Patch the cached item-detail bundle for `ratingKey` (every server) with a
 * known-correct `item.viewOffset`, in place, leaving every other field of the
 * bundle (seasons/episodes/parentShow/siblings) untouched. Returns whether a
 * matching entry was found and patched.
 */
function patchItemDetailCache(ratingKey: string, viewOffsetMs: number): boolean {
  let patched = false;
  cacheUpdateWhere<DetailBundleLike>(
    (key) => key.startsWith("item-detail:") && key.endsWith(`:${ratingKey}`),
    (bundle) => {
      if (!bundle?.item) return undefined;
      patched = true;
      return { ...bundle, item: { ...bundle.item, viewOffset: viewOffsetMs } };
    },
  );
  return patched;
}

/**
 * How long a just-recorded offset "wins" over a fetched value for the same
 * ratingKey. Bridges the gap between the synchronous patch above and a
 * refetch that's already in flight (or gets triggered immediately after, e.g.
 * useDashboard's own watch-state-changed listener refetching the deck on the
 * same event) — see {@link applyOffsetFloors} for the exact merge rule.
 */
export const OFFSET_FLOOR_WINDOW_MS = 5_000;

interface OffsetFloor {
  viewOffsetMs: number;
  /** True for an early-stop resume-marker clear — see WatchStateChangedDetail.reset. */
  reset: boolean;
  expiresAt: number;
}

const offsetFloors = new Map<string, OffsetFloor>();

/**
 * Record a known-correct offset for `ratingKey`, expiring after
 * {@link OFFSET_FLOOR_WINDOW_MS}. Exported (in addition to being called from
 * this module's own event handler) purely so tests can set up a floor
 * directly — it has no dependency on the cache primitives (unlike
 * patchDeckCaches/patchItemDetailCache), so it's safe to call from a test
 * context that mocks api-cache narrowly (e.g. useDashboard.test.ts).
 */
export function registerOffsetFloor(ratingKey: string, viewOffsetMs: number, reset: boolean): void {
  offsetFloors.set(ratingKey, {
    viewOffsetMs,
    reset,
    expiresAt: Date.now() + OFFSET_FLOOR_WINDOW_MS,
  });
}

/**
 * Apply any live offset floor to a freshly fetched item list (prexu-8nl0).
 *
 * Race being guarded against: useDashboard's own watch-state-changed listener
 * refetches the deck immediately on the same event this module patches the
 * cache from — a refetch PMS may not have finished ingesting yet, so its
 * response can still carry the PRE-stop viewOffset. Left unguarded, that
 * refetch's result would silently overwrite the correct, client-known value
 * the patch just wrote moments earlier.
 *
 * Merge rule per item, while its floor hasn't expired:
 * - `reset` floors (an early-stop `/:/unscrobble` clear) always win: the
 *   client just told the server there is no resume point, so any nonzero
 *   fetched offset is definitionally the stale pre-stop value, never a newer
 *   one.
 * - Otherwise (a recorded resume offset), the LARGER of the two wins — the
 *   floor guards against a stale/smaller fetched value, while a fetched value
 *   that's equal or larger reflects confirmed-ingested (or newer) progress
 *   and is trusted as-is.
 *
 * Expired floors are lazily dropped as they're encountered. Callers (e.g.
 * useDashboard's fetchDeck, right after `getOnDeck` resolves) should run every
 * network response for onDeck items through this before it's applied to state
 * or cache — it is a no-op (returns the same array reference) once no floors
 * are live.
 */
export function applyOffsetFloors<T extends { ratingKey: string; viewOffset?: number }>(
  items: T[],
): T[] {
  if (offsetFloors.size === 0) return items;
  const now = Date.now();
  let changed = false;
  const next = items.map((item) => {
    const floor = offsetFloors.get(item.ratingKey);
    if (!floor) return item;
    if (floor.expiresAt <= now) {
      offsetFloors.delete(item.ratingKey);
      return item;
    }
    const fetched = item.viewOffset ?? 0;
    const resolved = floor.reset ? floor.viewOffsetMs : Math.max(fetched, floor.viewOffsetMs);
    if (resolved === fetched) return item;
    changed = true;
    logger.debug("playback", "stale response overridden", {
      ratingKey: item.ratingKey,
      serverOffset: fetched,
      patchedOffset: resolved,
    });
    return { ...item, viewOffset: resolved };
  });
  return changed ? next : items;
}

/**
 * Test-only escape hatch to reset the offset-floor registry between tests
 * that don't go through a full module reset. Not used in production code.
 */
export function __clearOffsetFloorsForTests(): void {
  offsetFloors.clear();
}
