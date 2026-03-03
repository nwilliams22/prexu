import { useState, useEffect } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop" | "large";

const BREAKPOINTS = {
  mobile: "(max-width: 767px)",
  tablet: "(min-width: 768px) and (max-width: 1024px)",
  desktop: "(min-width: 1025px) and (max-width: 1440px)",
  large: "(min-width: 1441px)",
} as const;

function getBreakpoint(): Breakpoint {
  if (window.matchMedia(BREAKPOINTS.mobile).matches) return "mobile";
  if (window.matchMedia(BREAKPOINTS.tablet).matches) return "tablet";
  if (window.matchMedia(BREAKPOINTS.large).matches) return "large";
  return "desktop";
}

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(getBreakpoint);

  useEffect(() => {
    const queries = Object.values(BREAKPOINTS).map((q) => window.matchMedia(q));

    const handleChange = () => {
      setBreakpoint(getBreakpoint());
    };

    queries.forEach((mql) => mql.addEventListener("change", handleChange));
    return () => {
      queries.forEach((mql) => mql.removeEventListener("change", handleChange));
    };
  }, []);

  return breakpoint;
}

/** True only for mobile breakpoint */
export function isMobile(bp: Breakpoint): boolean {
  return bp === "mobile";
}

/** True for mobile or tablet breakpoints */
export function isTabletOrBelow(bp: Breakpoint): boolean {
  return bp === "mobile" || bp === "tablet";
}

/** True for desktop or large breakpoints */
export function isDesktopOrAbove(bp: Breakpoint): boolean {
  return bp === "desktop" || bp === "large";
}
