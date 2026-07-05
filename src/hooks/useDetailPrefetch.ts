/**
 * Hover-intent prefetch of item detail metadata (prexu-0szx.15).
 *
 * Returns a single stable callback that warms the ItemDetail SWR cache
 * (see warmItemDetailCache in useItemDetailData.ts) for a ratingKey, so
 * that by the time the user finishes a hover-and-click the detail page
 * renders from cache instead of cold-fetching.
 *
 * The callback identity never changes across renders — safe to pass to
 * memoized cards (PosterCard's memo() is prop-identity based, prexu-0szx.13).
 * The freshest server is read from a ref at call time, so a server switch
 * never leaves the handler warming the old server's cache.
 *
 * Prefetch only makes sense for cards that navigate to the /item/ detail
 * route — collection/playlist cards have their own detail pages backed by
 * different data, so their call sites must NOT wire this up.
 */

import { useCallback, useRef } from "react";
import { useAuth } from "./useAuth";
import { warmItemDetailCache } from "./useItemDetailData";
import { logger } from "../services/logger";

export function useDetailPrefetch(): (ratingKey: string) => void {
  const { server } = useAuth();
  const serverRef = useRef(server);
  serverRef.current = server;

  return useCallback((ratingKey: string) => {
    const current = serverRef.current;
    if (!current) return;
    logger.debug("detail", "hover-intent prefetch", { ratingKey });
    void warmItemDetailCache(current, ratingKey);
  }, []);
}
