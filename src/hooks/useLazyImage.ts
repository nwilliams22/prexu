/**
 * Intersection Observer-based lazy image loading.
 * Shows a placeholder until the image enters the viewport.
 */

import { useState, useEffect, useRef, useCallback } from "react";

interface UseLazyImageResult {
  /** Ref to attach to the image container element */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the image should be loaded (in or near viewport) */
  shouldLoad: boolean;
  /** Whether the image has finished loading */
  isLoaded: boolean;
  /** Whether the image failed to load */
  hasError: boolean;
  /** Call when the image's onLoad fires */
  onLoad: () => void;
  /** Call when the image's onError fires */
  onError: () => void;
}

export function useLazyImage(rootMargin = "200px"): UseLazyImageResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  const onLoad = useCallback(() => setIsLoaded(true), []);
  const onError = useCallback(() => setHasError(true), []);

  return { containerRef, shouldLoad, isLoaded, hasError, onLoad, onError };
}
