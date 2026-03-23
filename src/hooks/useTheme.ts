import { useEffect } from "react";
import type { ThemeMode } from "../types/preferences";

/**
 * Applies the selected theme to the document root element
 * via a `data-theme` attribute. CSS uses this to switch variables.
 */
export function useThemeEffect(theme: ThemeMode) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
    return () => {
      root.removeAttribute("data-theme");
    };
  }, [theme]);
}
