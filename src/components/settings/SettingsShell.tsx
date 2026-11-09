import { useLayoutEffect, useRef, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import "./settings.css";

export const SETTINGS_CATEGORIES = [
  { id: "playback", label: "Playback", description: "Choose video quality and playback behavior." },
  { id: "audio", label: "Audio", description: "Choose your audio language, volume and timing." },
  { id: "subtitles", label: "Subtitles", description: "Choose subtitle language, size and style." },
  { id: "appearance", label: "Appearance", description: "Customize the look of Prexu and how you browse." },
  { id: "connections", label: "Connections & notifications", description: "Configure the relay and invitation sounds." },
  { id: "parental-controls", label: "Parental controls", description: "Manage content restrictions for members of your Plex Home." },
  { id: "about", label: "About", description: "App information and support." },
] as const;

export type SettingsCategory = typeof SETTINGS_CATEGORIES[number]["id"];

interface SettingsShellProps {
  category: SettingsCategory;
  isAdmin: boolean;
  children: ReactNode;
  /** Reserved for the search and persistence slices. */
  headerContent?: ReactNode;
}

export function SettingsShell({ category, isAdmin, children, headerContent }: SettingsShellProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const categories = SETTINGS_CATEGORIES.filter((item) => isAdmin || item.id !== "parental-controls");
  const current = SETTINGS_CATEGORIES.find((item) => item.id === category)!;

  useLayoutEffect(() => {
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
  }, [location.pathname, location.hash]);

  return (
    <div className="settings-container" ref={rootRef}>
      <div className="settings-shell">
        <header className="settings-header">
          <h1>Settings</h1>
          <p>Playback and appearance preferences apply to your profile. Connections and notifications apply to this app.</p>
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
            <div className="settings-category-heading">
              <h2 ref={headingRef} tabIndex={-1}>{current.label}</h2>
              <p>{current.description}</p>
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
