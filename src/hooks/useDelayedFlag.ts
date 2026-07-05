import { useEffect, useState } from "react";

/**
 * Returns `true` only once `active` has been continuously true for at
 * least `delayMs`. Flips back to `false` immediately as soon as `active`
 * goes false.
 *
 * Used to gate loading spinners/skeletons so a fetch that resolves
 * quickly (warm cache, fast LAN) never flashes a loading state at all —
 * the same "pre-show delay" idea as the AppLayout route-transition
 * spinner fix (prexu-0szx.8), generalized for page-level data hooks
 * (prexu-0szx.17).
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const id = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(id);
  }, [active, delayMs]);

  return shown;
}
