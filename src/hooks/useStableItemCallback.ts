/**
 * Cache one event handler PER key across renders (prexu-0szx.13).
 *
 * List call sites commonly do `onClick={() => doThing(item)}` inline inside
 * a `.map()` — a fresh arrow function every render, even when `item` itself
 * hasn't changed. Passed straight into a memoized child (e.g. PosterCard),
 * that fresh identity defeats React.memo on every parent re-render.
 *
 * `getStableCallback(key, latest, run)` returns the SAME function reference
 * for a given `key` across renders. `run` is invoked with the freshest
 * `latest` value available at CLICK time (read from a ref), not whatever
 * was captured when the handler was first created — so the cached handler
 * never goes stale even though its identity never changes.
 */

import { useCallback, useRef } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any -- generic callback shape,
   constrained by callers via the F type parameter (e.g. `() => void` for
   onClick, `(e: React.MouseEvent) => void` for onContextMenu). */
export function useStableItemCallback<T, F extends (...args: any[]) => void>() {
  const latestRef = useRef(new Map<string, T>());
  const runRef = useRef<((latest: T, ...args: Parameters<F>) => void) | undefined>(
    undefined,
  );
  const handlersRef = useRef(new Map<string, F>());

  return useCallback(
    (
      key: string,
      latest: T,
      run: (latest: T, ...args: Parameters<F>) => void,
    ): F => {
      latestRef.current.set(key, latest);
      runRef.current = run;

      const cached = handlersRef.current.get(key);
      if (cached) return cached;

      const handler = ((...args: Parameters<F>) => {
        const current = latestRef.current.get(key) as T;
        runRef.current?.(current, ...args);
      }) as F;
      handlersRef.current.set(key, handler);
      return handler;
    },
    [],
  );
}
