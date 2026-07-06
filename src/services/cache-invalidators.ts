/**
 * Module-level cache invalidation listeners that persist across component
 * mount/unmount cycles. Ensures dashboard cache stays fresh even when the
 * Dashboard component is unmounted (e.g., while the Player overlay is active).
 */

import { cacheInvalidateWhere } from "./api-cache";
import { onWatchStateChanged } from "./watch-state-events";
import { logger } from "./logger";

/**
 * Initialize cache invalidation listeners. Call once at app startup.
 * Sets up a persistent listener that invalidates the onDeck cache whenever
 * playback watch state changes (resume offset cleared or recorded).
 */
export function initializeCacheInvalidators(): void {
  // When playback stops and watch state is updated on the server, invalidate
  // all onDeck cache entries so the Dashboard refetches when it remounts.
  // Pattern: dashboard:{serverUri}:deck
  const unsubscribe = onWatchStateChanged(() => {
    invalidateDeckCaches();
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
