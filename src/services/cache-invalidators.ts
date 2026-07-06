/**
 * Module-level cache invalidation listeners that persist across component
 * mount/unmount cycles. Ensures dashboard cache stays fresh even when the
 * Dashboard component is unmounted (e.g., while the Player overlay is active).
 */

import { cacheInvalidateWhere } from "./api-cache";
import { onWatchStateChanged } from "./watch-state-events";
import { logger } from "./logger";

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
  const unsubscribe = onWatchStateChanged((ratingKey) => {
    logger.debug("api", "deck cache invalidation scheduled", {
      delayMs: DECK_INVALIDATION_DELAY_MS,
    });
    setTimeout(() => {
      invalidateDeckCaches();
    }, DECK_INVALIDATION_DELAY_MS);

    invalidateItemDetailCaches(ratingKey);
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
