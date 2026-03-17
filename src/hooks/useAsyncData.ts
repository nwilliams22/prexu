/**
 * Generic async data fetching hook with loading, error, and retry.
 *
 * Replaces the repeated pattern of:
 *   const [data, setData] = useState(null);
 *   const [loading, setLoading] = useState(true);
 *   const [error, setError] = useState(null);
 *   useEffect(() => { let cancelled = false; (async () => { ... })(); ... }, [deps]);
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface AsyncDataResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  /** Re-run the fetch function. */
  refresh: () => void;
}

/**
 * Fetch async data with automatic loading/error state management.
 *
 * @param fetchFn  Async function that returns the data. Receives an AbortSignal-like
 *                 `isCancelled` callback so long-running multi-step fetches can bail out.
 *                 Return `null` to indicate "no data" without an error.
 * @param deps     Dependency array — re-fetches when any value changes.
 *                 Pass `null` as any dep to skip fetching entirely (e.g. when server is not yet available).
 */
export function useAsyncData<T>(
  fetchFn: (isCancelled: () => boolean) => Promise<T | null>,
  deps: unknown[],
): AsyncDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);

  const execute = useCallback(() => {
    // Skip if any dependency is null/undefined (common pattern: server not ready)
    if (deps.some((d) => d === null || d === undefined)) {
      setIsLoading(false);
      return;
    }

    const version = ++versionRef.current;
    let cancelled = false;

    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const result = await fetchFn(() => cancelled);

        if (!cancelled && version === versionRef.current) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled && version === versionRef.current) {
          setError(
            err instanceof Error ? err.message : "An unexpected error occurred",
          );
        }
      } finally {
        if (!cancelled && version === versionRef.current) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const cleanup = execute();
    return cleanup;
  }, [execute]);

  const refresh = useCallback(() => {
    execute();
  }, [execute]);

  return { data, isLoading, error, refresh };
}
