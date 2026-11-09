import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useHomeUsers } from "../../hooks/useHomeUsers";
import { useParentalControls } from "../../hooks/useParentalControls";
import { RATING_LEVELS, RATING_LABELS, DEFAULT_PARENTAL_CONTROLS, type ContentRatingLevel, type ParentalControlSettings } from "../../types/parental-controls";
import { SettingsRow, SettingsSection } from "./SettingsPrimitives";
import { useSettingsDraft } from "./SettingsDraftGuard";

export function ParentalControlsPanel({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) return <><p>Parental controls are available to administrators</p><Link to="/settings/playback">Back to Playback</Link></>;
  return <ManagedUserControls />;
}

function ManagedUserControls() {
  const { homeUsers, isPlexHome, isLoading, loadError, retryLoad } = useHomeUsers();
  const { loadForUser, saveForUser } = useParentalControls();
  const managedUsers = homeUsers.filter((user) => !user.admin);
  const ids = managedUsers.map((user) => user.id).join(",");
  const [loadedIds, setLoadedIds] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<Record<number, ParentalControlSettings>>({});
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState(DEFAULT_PARENTAL_CONTROLS);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const [message, setMessage] = useState("");
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const [failedAvatars, setFailedAvatars] = useState<number[]>([]);
  useEffect(() => {
    let current = true;
    setError(false); setLoadedIds(null); setEditing(null);
    const userIds = ids ? ids.split(",").map(Number) : [];
    Promise.all(userIds.map(async (id) => [id, await loadForUser(id)] as const)).then((entries) => {
      if (current) { setUserSettings(Object.fromEntries(entries)); setLoadedIds(ids); }
    }, () => { if (current) setError(true); });
    return () => { current = false; };
  }, [ids, loadForUser, attempt]);
  const previousEditor = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (previousEditor.current !== null && editing === null) buttons.current.get(previousEditor.current)?.focus();
    previousEditor.current = editing;
  }, [editing]);
  const confirmed = editing === null ? null : userSettings[editing];
  const dirty = Boolean(confirmed && (draft.enabled !== confirmed.enabled || draft.maxContentRating !== confirmed.maxContentRating));
  function cancel() { if (editing !== null) buttons.current.get(editing)?.focus(); setEditing(null); setSaveError(false); }
  const request = useSettingsDraft(dirty || saving, cancel);
  async function save() {
    if (editing === null || !dirty || savingRef.current) return;
    const id = editing;
    savingRef.current = true; setSaving(true); setSaveError(false);
    try {
      await saveForUser(id, draft);
      setUserSettings((prev) => ({ ...prev, [id]: draft }));
      setMessage(`Restrictions updated for ${managedUsers.find((user) => user.id === id)?.title ?? "user"}`);
      setEditing(null); buttons.current.get(id)?.focus();
    } catch { setSaveError(true); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <div id="parental-controls-section">
    <h3 tabIndex={-1} id="parental-controls-target">Managed users</h3>
    <p className="settings-help">Restrictions for each managed user on this device.</p>
    <p className="settings-help">Hides content above this rating in Prexu. TV ratings use the equivalent movie rating. Unrated or unknown content uses NC-17.</p>
    {loadError || error ? <p role="alert">Could not load parental controls. <button onClick={() => { if (loadError) retryLoad?.(); setAttempt((n) => n + 1); }}>Retry</button></p>
      : isLoading || loadedIds !== ids ? <div role="status">Loading managed users and restrictions…</div>
      : !isPlexHome || !managedUsers.length ? <p>No managed users available</p>
      : managedUsers.map((user) => {
        const settings = userSettings[user.id]!;
        return <SettingsSection key={user.id} id={`parental-user-${user.id}`} title={user.title}>
          <div className="settings-user-summary">
            {user.thumb && !failedAvatars.includes(user.id) ? <img width={36} height={36} src={user.thumb} alt="" onError={() => setFailedAvatars((old) => [...old, user.id])} /> : <span className="settings-user-initial" aria-hidden="true">{user.title.slice(0, 1)}</span>}
            {user.protected && <span>Protected profile</span>}
            <p>{settings.enabled && settings.maxContentRating !== "none" ? `Maximum rating: ${RATING_LABELS[settings.maxContentRating]}` : "No restrictions"}</p>
            <button aria-label={`Edit ${user.title}`} ref={(button) => { if (button) buttons.current.set(user.id, button); else buttons.current.delete(user.id); }} disabled={saving || editing === user.id} onClick={() => request(() => { setDraft(settings); setEditing(user.id); setSaveError(false); setMessage(""); })}>Edit<span className="sr-only"> {user.title}</span></button>
          </div>
          {editing === user.id && <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <SettingsRow id="C1" label="Enable content restrictions">
              {(props) => <input {...props} autoFocus type="checkbox" checked={draft.enabled} disabled={saving} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />}
            </SettingsRow>
            <SettingsRow id="C2" label="Maximum Allowed Rating" help={!draft.enabled ? "Enable content restrictions to choose a maximum rating." : undefined}>
              {(props) => <select {...props} value={draft.maxContentRating} disabled={saving || !draft.enabled} onChange={(e) => setDraft({ ...draft, maxContentRating: e.target.value as ContentRatingLevel })}>
                {RATING_LEVELS.map((rating) => <option key={rating} value={rating}>{RATING_LABELS[rating]}</option>)}
              </select>}
            </SettingsRow>
            <div className="settings-actions"><button type="submit" disabled={!dirty || saving}>{saving ? "Saving…" : "Save changes"}</button><button type="button" disabled={saving} onClick={cancel}>Cancel</button></div>
            {saveError && <p role="alert" className="settings-error">Could not save restrictions. <button type="button" disabled={saving} onClick={() => void save()}>Retry</button></p>}
          </form>}
        </SettingsSection>;
      })}
    <p role="status">{message}</p>
  </div>;
}
