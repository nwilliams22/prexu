import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { SETTINGS_CATEGORIES } from "./settingsCategories";
import type { SettingSearchEntry } from "./settingsSearch";

function useClearSearch() {
  const location = useLocation();
  const navigate = useNavigate();
  return (query: string) => {
    const params = new URLSearchParams(location.search);
    if (query) params.set("q", query); else params.delete("q");
    navigate({ pathname: location.pathname, search: params.toString(), hash: "" }, { replace: true });
  };
}

export function SettingsSearch({ query }: { query: string }) {
  const update = useClearSearch();
  const input = useRef<HTMLInputElement>(null);
  return <div className="settings-search">
    <label htmlFor="settings-search">Search settings</label>
    <div className="settings-actions">
      <input ref={input} id="settings-search" type="search" placeholder="Search settings" value={query}
        onChange={(event) => update(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); update(""); input.current?.focus(); }
        }} />
      {query && <button type="button" onClick={() => { update(""); input.current?.focus(); }}>Clear search</button>}
    </div>
  </div>;
}

export function SettingsSearchResults({ query, results }: { query: string; results: readonly SettingSearchEntry[] }) {
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAnnouncement(`${results.length} ${results.length === 1 ? "setting" : "settings"} found`), 200);
    return () => clearTimeout(timer);
  }, [query, results.length]);
  return <section aria-labelledby="settings-results-heading">
    <h2 id="settings-results-heading">Search results</h2>
    <p role="status" aria-live="polite">{announcement}</p>
    {results.length === 0 ? <p>No settings match ‘{query.trim()}’</p> : <ul className="settings-search-results">
      {results.map((item) => <li key={item.id}>
        <Link to={`/settings/${item.category}#setting-${item.id}`}>
          <strong>{item.label}</strong>
          <span>{SETTINGS_CATEGORIES.find((category) => category.id === item.category)!.label} › {item.section}</span>
          <span>{item.help}</span>
        </Link>
      </li>)}
    </ul>}
  </section>;
}
