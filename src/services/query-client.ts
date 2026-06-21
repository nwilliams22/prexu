/**
 * Shared TanStack Query client for the app.
 *
 * Defaults tuned for a Tauri desktop client talking to a Plex server:
 * - staleTime 30s: most library/detail data is stable for a session, so we
 *   avoid refetch storms when navigating between pages.
 * - retry 1: Plex requests that fail are usually auth/connectivity issues that
 *   a single retry won't fix; one retry covers transient blips without long
 *   stalls.
 * - refetchOnWindowFocus false: a desktop app regaining focus should not
 *   silently refire every active query.
 */

import { QueryClient } from "@tanstack/react-query";
import { logger } from "./logger";

export function createQueryClient(): QueryClient {
  logger.debug("query", "creating QueryClient");
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** App-wide singleton query client. */
export const queryClient = createQueryClient();
