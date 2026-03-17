import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

const STORAGE_PREFIX = "prexu_scroll_";

/**
 * Saves and restores scroll position of the <main> scroll container
 * when navigating between routes. Uses sessionStorage keyed by pathname.
 *
 * Key design decisions:
 * - Tracks scroll position in a ref (updated on every scroll event)
 * - Saves via useLayoutEffect cleanup, which runs BEFORE the DOM is
 *   torn down on unmount. A regular useEffect cleanup would run after
 *   the old content has been removed from <main>, at which point
 *   scrollTop has already been reset to 0 by the browser.
 * - Restores via a MutationObserver that waits for async content to
 *   render (API data loads after mount, so the page isn't tall enough
 *   for scroll restoration on the first frame).
 */
export function useScrollRestoration() {
  const { pathname } = useLocation();
  const storageKey = STORAGE_PREFIX + pathname;
  const scrollRef = useRef(0);
  const restoredRef = useRef(false);

  // Save scroll position to sessionStorage BEFORE DOM changes on unmount.
  // useLayoutEffect cleanup fires synchronously before React removes the
  // component's DOM nodes, so main.scrollTop still reflects the real position.
  useLayoutEffect(() => {
    return () => {
      sessionStorage.setItem(storageKey, String(scrollRef.current));
    };
  }, [storageKey]);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;

    // Initialize ref with current scroll position
    scrollRef.current = main.scrollTop;
    restoredRef.current = false;

    const saved = sessionStorage.getItem(storageKey);
    const targetScroll = saved ? parseInt(saved, 10) : 0;

    // Attempt to restore scroll position once content is tall enough
    function tryRestore() {
      if (restoredRef.current || isNaN(targetScroll) || targetScroll <= 0) return;
      if (main!.scrollHeight >= targetScroll) {
        main!.scrollTop = targetScroll;
        scrollRef.current = targetScroll;
        restoredRef.current = true;
      }
    }

    // Initial attempt after first paint
    requestAnimationFrame(tryRestore);

    // Watch for DOM changes (async data loading renders new content)
    let observer: MutationObserver | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    if (targetScroll > 0) {
      observer = new MutationObserver(() => {
        tryRestore();
        if (restoredRef.current && observer) {
          observer.disconnect();
          observer = null;
          if (safetyTimer) clearTimeout(safetyTimer);
        }
      });
      observer.observe(main, { childList: true, subtree: true });

      // Stop trying after 5 seconds
      safetyTimer = setTimeout(() => {
        if (observer) {
          tryRestore();
          observer.disconnect();
          observer = null;
        }
      }, 5000);
    }

    // Track scroll position in ref on every scroll
    const handleScroll = () => {
      scrollRef.current = main.scrollTop;
    };

    main.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (observer) observer.disconnect();
      if (safetyTimer) clearTimeout(safetyTimer);
      main.removeEventListener("scroll", handleScroll);
    };
  }, [storageKey]);
}
