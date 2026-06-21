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

  return useMemo(() => {
    const details = new Map<string, ItemDetail>();
    let pending = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const result = results[i];
      if (!item || !result) continue;
      if (result.data) details.set(item.ratingKey, result.data);
      if (result.isPending && result.fetchStatus !== "idle") pending = true;
    }
    return { details, isLoading: pending };
  }, [items, results]);
}
