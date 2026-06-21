/**
 * Generic detail-page data hook built on TanStack Query.
 *
 * Both CollectionDetail and PlaylistDetail need the same flow: fetch a
 * container's metadata, fetch its (paginated) items, and surface
 * loading/error/empty state. This hook owns that flow generically; callers
 * inject the two fetchers and a query key, so caching/dedup/cancellation are
 * handled by react-query instead of hand-rolled useEffect + cancel refs.
 */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { logger } from "../services/logger";
import type { PaginatedResult, PlexMediaItem } from "../types/library";

export interface PlexServerLike {
  uri: string;
  accessToken: string;
}

export interface UseDetailItemsParams<M, I extends PlexMediaItem> {
  /** Stable identifier for this container (collectionKey / playlistKey). */
  containerKey: string | undefined;
  /** react-query key prefix, e.g. "collection-detail" or "playlist-detail". */
  queryKey: string;
  /** Fetch the container's metadata (title, summary, art, etc.). */
  fetchMetadata: (server: PlexServerLike, key: string) => Promise<M>;
  /** Fetch the container's items (paginated). */
  fetchItems: (
    server: PlexServerLike,
    key: string,
  ) => Promise<PaginatedResult<I>>;
}

export interface UseDetailItemsResult<M, I extends PlexMediaItem> {
  /** Container metadata, or null until loaded / on failure. */
  metadata: M | null;
  items: I[];
  totalSize: number;
  /** True while either metadata or items are loading for the first time. */
  isLoading: boolean;
  /** True while the metadata query is loading for the first time. */
  isMetadataLoading: boolean;
  /** True while the items query is loading for the first time. */
  isItemsLoading: boolean;
  /** True when the items query failed (metadata failure is non-fatal). */
  isError: boolean;
  /** Human-readable error message from the items query, or null. */
  error: string | null;
  /** Force a refetch of both metadata and items (bypasses staleTime). */
  refetch: () => void;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function useDetailItems<M, I extends PlexMediaItem>(
  params: UseDetailItemsParams<M, I>,
): UseDetailItemsResult<M, I> {
  const { containerKey, queryKey, fetchMetadata, fetchItems } = params;
  const { server } = useAuth();

  const enabled = Boolean(server && containerKey);
  const serverUri = server?.uri ?? "";

  const metadataQuery = useQuery({
    queryKey: [queryKey, "metadata", serverUri, containerKey],
    enabled,
    queryFn: async () => {
      logger.debug("detail", `${queryKey} fetch metadata`, { containerKey });
      return fetchMetadata(server as PlexServerLike, containerKey as string);
    },
  });

  const itemsQuery = useQuery({
    queryKey: [queryKey, "items", serverUri, containerKey],
    enabled,
    queryFn: async () => {
      logger.debug("detail", `${queryKey} fetch items`, { containerKey });
      return fetchItems(server as PlexServerLike, containerKey as string);
    },
  });

  const isMetadataLoading = enabled && metadataQuery.isPending;
  const isItemsLoading = enabled && itemsQuery.isPending;
  const isLoading = isMetadataLoading || isItemsLoading;

  return {
    metadata: metadataQuery.data ?? null,
    items: itemsQuery.data?.items ?? [],
    totalSize: itemsQuery.data?.totalSize ?? 0,
    isLoading,
    isMetadataLoading,
    isItemsLoading,
    isError: itemsQuery.isError,
    error: itemsQuery.isError
      ? errorMessage(itemsQuery.error, "Failed to load items")
      : null,
    refetch: () => {
      logger.debug("detail", `${queryKey} refetch`, { containerKey });
      void metadataQuery.refetch();
      void itemsQuery.refetch();
    },
  };
}
