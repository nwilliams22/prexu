/**
 * Intersection Observer-based lazy image loading with blur-up support.
 * Shows a tiny blurred placeholder that transitions to the full image.
 *
 * A shared IntersectionObserver is maintained per rootMargin string at
 * module level so all consumers share a single IO instance rather than
 * each card creating its own. Callbacks are keyed by element and cleaned
 * up automatically on unmount.
 */

import { useState, useEffect, useRef, useCallback } from "react";

interface UseLazyImageResult {
  /** Ref to attach to the image container element */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Ref to attach to the full-resolution <img> element */
  imgRef: React.RefObject<HTMLImageElement | null>;
  /** Whether the image should be loaded (in or near viewport) */
  shouldLoad: boolean;
  /** Whether the image has finished loading */
  isLoaded: boolean;
  /** Whether the image failed to load */
  hasError: boolean;
  /** Whether the blur-up placeholder has loaded */
  placeholderLoaded: boolean;
  /** Call when the image's onLoad fires */
  onLoad: () => void;
  /** Call when the image's onError fires */
  onError: () => void;
  /** Call when the placeholder image's onLoad fires */
  onPlaceholderLoad: () => void;
}

// ---------------------------------------------------------------------------
// Shared observer pool — one IntersectionObserver per distinct rootMargin.
// Callbacks are keyed by element so each consumer handles its own entry.
// ---------------------------------------------------------------------------

interface SharedObserverEntry {
  observer: IntersectionObserver;
  callbacks: Map<Element, () => void>;
}

const sharedObservers = new Map<string, SharedObserverEntry>();

/**
 * Clears the shared-observer pool. Call only from tests — production code
 * has no reason to reset module-level state.
 * @internal
 */
export function _resetSharedObserversForTesting(): void {
  for (const { observer } of sharedObservers.values()) {
    observer.disconnect();
  }
  sharedObservers.clear();
}

function getSharedObserver(rootMargin: string): SharedObserverEntry {
  let entry = sharedObservers.get(rootMargin);
  if (!entry) {
    const callbacks = new Map<Element, () => void>();
    const observer = new IntersectionObserver(
      (ioEntries) => {
        for (const ioEntry of ioEntries) {
          if (ioEntry.isIntersecting) {
            const cb = callbacks.get(ioEntry.target);
            if (cb) {
              cb();
              // Once triggered, unobserve — identical to the per-card behaviour.
              observer.unobserve(ioEntry.target);
              callbacks.delete(ioEntry.target);
            }
          }
        }
      },
      { rootMargin },
    );
    entry = { observer, callbacks };
    sharedObservers.set(rootMargin, entry);
  }
  return entry;
}

function registerElement(
  rootMargin: string,
  el: Element,
  cb: () => void,
): void {
  const { observer, callbacks } = getSharedObserver(rootMargin);
  callbacks.set(el, cb);
  observer.observe(el);
}

function unregisterElement(rootMargin: string, el: Element): void {
  const entry = sharedObservers.get(rootMargin);
  if (!entry) return;
  entry.observer.unobserve(el);
  entry.callbacks.delete(el);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLazyImage(rootMargin = "200px"): UseLazyImageResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [placeholderLoaded, setPlaceholderLoaded] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    registerElement(rootMargin, el, () => setShouldLoad(true));

    return () => {
      unregisterElement(rootMargin, el);
    };
  }, [rootMargin]);

  // After shouldLoad flips true the <img> is rendered and its src is set.
  // If the image is already in the browser cache the browser fires the load
  // event synchronously during element creation — before React commits the
  // element and attaches the onLoad prop — so the swap never happens.
  // After each render where shouldLoad is true we check img.complete and
  // trigger the resolved state ourselves to handle that race.
  useEffect(() => {
    if (!shouldLoad) return;
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) {
      if (img.naturalWidth > 0) {
        setIsLoaded(true);
      } else {
        setHasError(true);
      }
    }
  });

  const onLoad = useCallback(() => setIsLoaded(true), []);
  const onError = useCallback(() => setHasError(true), []);
  const onPlaceholderLoad = useCallback(() => setPlaceholderLoaded(true), []);

  return {
    containerRef,
    imgRef,
    shouldLoad,
    isLoaded,
    hasError,
    placeholderLoaded,
    onLoad,
    onError,
    onPlaceholderLoad,
  };
}
