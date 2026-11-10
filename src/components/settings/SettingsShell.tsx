import { useLayoutEffect, useRef, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import "./settings.css";

import { SETTINGS_CATEGORIES, type SettingsCategory } from "./settingsCategories";
export { SETTINGS_CATEGORIES, type SettingsCategory } from "./settingsCategories";
import { SettingsSearch, SettingsSearchResults } from "./SettingsSearch";
import { searchSettings, focusSettingTarget } from "./settingsSearchIndex";
import { IS_NATIVE_PLAYER_PLATFORM } from "../../hooks/player/engineResolution";
interface SettingsShellProps {
  category: SettingsCategory;
  profileName?: string;
  isAdmin: boolean;
  children: ReactNode;
  /** Persistence feedback remains visible while searching. */
  headerContent?: ReactNode;
}

export function SettingsShell({ category, isAdmin, children, headerContent, profileName }: SettingsShellProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search).get("q") ?? "";
  const searching = Boolean(query.trim());
  const results = searchSettings(query, { isAdmin, nativePlayer: IS_NATIVE_PLAYER_PLATFORM });
  const categories = SETTINGS_CATEGORIES.filter((item) => isAdmin || item.id !== "parental-controls");
  const current = SETTINGS_CATEGORIES.find((item) => item.id === category)!;

  useLayoutEffect(() => {
    if (searching) { document.getElementById("settings-search")?.focus({ preventScroll: true }); return; }
    if (document.activeElement?.id === "settings-search" && !location.hash) return;
    if (location.hash.startsWith("#setting-")) {
      focusSettingTarget(location.hash.slice(9), category, { isAdmin, nativePlayer: IS_NATIVE_PLAYER_PLATFORM });
      return;
    }
    // A targeted result owns focus; ordinary navigation always starts at the top.
    if (location.hash) {
      if (location.hash === "#N2-row") {
        const target = document.getElementById("N2");
        target?.scrollIntoView?.({ block: "center", behavior: "instant" });
        target?.focus({ preventScroll: true });
      }
      return;
    }
    rootRef.current?.closest("main")?.scrollTo?.({ top: 0, behavior: "instant" });
    headingRef.current?.focus({ preventScroll: true });
  }, [location.pathname, location.hash, searching, category, isAdmin]);

  return (
    <div className="settings-container" ref={rootRef}>
      <div className="settings-shell">
        <header className="settings-header">
          <h1>Settings</h1>
          <p>{category === "connections" ? "These settings apply to all profiles on this device." : category === "parental-controls" ? "Restrictions for each managed user on this device." : profileName ? `Preferences for ${profileName} on this device.` : "Preferences on this device."}</p>
          <SettingsSearch query={query} />
          {headerContent && <div className="settings-header-content">{headerContent}</div>}
        </header>
        <div className="settings-mobile-nav">
          <label htmlFor="settings-category">Settings category</label>
          <select id="settings-category" value={category} onChange={(event) => navigate(`/settings/${event.target.value}`)}>
            {categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <div className="settings-columns">
          <nav className="settings-nav" aria-label="Settings categories">
            {categories.map((item) => <NavLink key={item.id} to={`/settings/${item.id}`}>{item.label}</NavLink>)}
          </nav>
          <div className="settings-content">
            {searching && <SettingsSearchResults query={query} results={results} />}
            <div hidden={searching}>
            <div className="settings-category-heading">
              <h2 ref={headingRef} tabIndex={-1}>{current.label}</h2>
              <p>{current.description}</p>
            </div>
            {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
