/**
 * Progressive per-item metadata fetcher built on TanStack Query.
 *
 * CollectionDetail renders rich rows (cast, crew, genres, duration) that
 * require a full getItemMetadata call per item. The old implementation did
 * this with a hand-rolled chunked loop that progressively updated a Map. This
 * hook replaces that with useQueries: each item's detail is an independent,
 * cached query, and the returned Map fills in progressively as queries
 * resolve — preserving the "rows appear as data loads" UX without manual
 * chunking or cancellation refs.
 */

import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "./useAuth";
import { getItemMetadata } from "../services/plex-library";
import { logger } from "../services/logger";
import type {
  PlexMediaItem,
  PlexMovie,
  PlexShow,
} from "../types/library";

export type ItemDetail = PlexMovie | PlexShow;

export interface UseItemDetailsResult {
  /** ratingKey → loaded detail. Grows as individual queries resolve. */
  details: Map<string, ItemDetail>;
  /** ratingKeys whose detail query is currently in flight (not yet resolved).
   *  Lets a per-row consumer show a loading placeholder for ITS OWN pending
   *  state instead of subscribing to a single shared boolean that flips
   *  whenever ANY item's query starts/settles. */
  pendingKeys: ReadonlySet<string>;
  /** True while at least one detail query is still pending. */
  isLoading: boolean;
}

export function useItemDetails(items: PlexMediaItem[]): UseItemDetailsResult {
  const { server } = useAuth();
  const serverUri = server?.uri ?? "";

  const results = useQueries({
    queries: items.map((item) => ({
      queryKey: ["item-detail", serverUri, item.ratingKey],
      enabled: Boolean(server),
      queryFn: async () => {
        logger.debug("detail", "fetch item detail", {
          ratingKey: item.ratingKey,
        });
        return getItemMetadata<ItemDetail>(
          (server as { uri: string }).uri,
          (server as { accessToken: string }).accessToken,
          item.ratingKey,
        );
      },
    })),
  });

  // useQueries always returns a brand-new array wrapper every render, even
  // when none of the underlying query results actually changed. Memoizing
  // the returned Map on `results` directly would therefore rebuild it (and
  // hand every consumer a new object reference) on EVERY render — including
  // renders triggered by something unrelated (e.g. a sibling row's hover
  // state). With N items that turns into an O(n^2) cascade: each of the N
  // query resolutions re-renders every row that reads the Map.
  //
  // Build a signature string keyed on each result's actual (status,
  // dataUpdatedAt) pair instead — this only changes when a query's status
  // or fetched data genuinely changes, so the Map (and its object identity)
  // stays stable across unrelated re-renders. Downstream memoized rows that
  // do `detailedItems.get(ratingKey)` then keep receiving the SAME detail
  // object reference until that item's own query actually resolves.
  const signature = results
    .map((r) => `${r.status}:${r.dataUpdatedAt}`)
    .join("|");

  return useMemo(() => {
    const details = new Map<string, ItemDetail>();
    const pendingKeys = new Set<string>();
    let pending = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const result = results[i];
      if (!item || !result) continue;
      if (result.data) details.set(item.ratingKey, result.data);
      if (result.isPending && result.fetchStatus !== "idle") {
        pending = true;
        pendingKeys.add(item.ratingKey);
      }
    }
    return { details, pendingKeys, isLoading: pending };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, signature]);
}
