import { useCallback, useEffect, useRef } from "react";

let liveRegion: HTMLDivElement | null = null;

function getOrCreateLiveRegion(): HTMLDivElement {
  if (liveRegion && document.body.contains(liveRegion)) return liveRegion;
  liveRegion = document.createElement("div");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");
  liveRegion.className = "sr-only";
  liveRegion.id = "a11y-live-region";
  document.body.appendChild(liveRegion);
  return liveRegion;
}

export function useAnnounce() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getOrCreateLiveRegion();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const announce = useCallback(
    (message: string, priority: "polite" | "assertive" = "polite") => {
      const region = getOrCreateLiveRegion();
      region.setAttribute("aria-live", priority);
      // Clear first so identical consecutive messages still announce
      region.textContent = "";
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        region.textContent = message;
      }, 50);
    },
    [],
  );

  return announce;
}
