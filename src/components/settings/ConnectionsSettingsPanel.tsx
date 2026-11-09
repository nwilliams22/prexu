import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getRelayUrl, hasManualRelayUrl, saveRelayUrl, clearRelayUrl, deriveRelayUrl,
  getInviteVolume, saveInviteVolume, getInviteSoundConfig, saveInviteSoundConfig,
  type BuiltinSound, type NotificationSoundConfig } from "../../services/storage";
import { previewSound, previewCustomDataUrl, validateCustomSound } from "../../utils/notificationSound";
import { SettingsSection, SettingsRow, SettingsRange, SettingsChoiceGroup } from "./SettingsPrimitives";
import { useSettingsDraft } from "./SettingsDraftGuard";
import { settingsAddress, validRelayAddress } from "./settingsAddress";
import { useDeviceSetting } from "./useDeviceSetting";
import { DeviceSaveStatus } from "./DeviceSaveStatus";

const loadVolume = () => getInviteVolume(true);
const loadSound = () => getInviteSoundConfig(true);
const sounds = ["chime", "bell", "pop", "ping", "soft", "custom"] as const;

export function ConnectionsSettingsPanel({ serverUri, isRelayConnected, refreshInvites, onFailureChange }: {
  serverUri?: string; isRelayConnected: boolean; refreshInvites: () => void; onFailureChange?: (failed: boolean) => void;
}) {
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [loadState, setLoadState] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [relayError, setRelayError] = useState(false);
  const [message, setMessage] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  const volume = useDeviceSetting(0.5, loadVolume, saveInviteVolume);
  const sound = useDeviceSetting<NotificationSoundConfig>({ sound: "chime" }, loadSound, saveInviteSoundConfig);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [validCustom, setValidCustom] = useState<string | null>(null);
  const fileVersion = useRef(0);
  useEffect(() => () => { fileVersion.current++; }, []);

  useEffect(() => {
    let current = true;
    setLoadState("loading");
    (async () => {
      const manual = await hasManualRelayUrl(true);
      const url = manual ? await getRelayUrl(undefined, true) : null;
      if (current) { setSavedUrl(url); setLoadState("ready"); }
    })().catch(() => { if (current) setLoadState("error"); });
    return () => { current = false; };
  }, [attempt]);
  useEffect(() => {
    let current = true;
    setValidCustom(null);
    const data = sound.value.customDataUrl;
    if (sound.value.sound === "custom" && data) {
      validateCustomSound(data).then(() => { if (current) setValidCustom(data); }, () => {});
    }
    return () => { current = false; };
  }, [sound.value]);

  useEffect(() => { onFailureChange?.(volume.status === "error" || sound.status === "error"); }, [volume.status, sound.status, onFailureChange]);
  const wasEditing = useRef(false);
  const wasSaving = useRef(false);
  useLayoutEffect(() => {
    if ((wasEditing.current || wasSaving.current) && !editing && !saving) editButton.current?.focus();
    wasEditing.current = editing;
    wasSaving.current = saving;
  }, [editing, saving]);

  function cancel() { setDraft(savedUrl ?? ""); setEditing(false); setRelayError(false); editButton.current?.focus(); }
  const dirty = editing && draft.trim() !== (savedUrl ?? "");
  useSettingsDraft(dirty || saving, cancel);
  const valid = validRelayAddress(draft);
  async function saveRelay(reset = false) {
    if (savingRef.current || (!reset && (!dirty || !valid))) return;
    savingRef.current = true; setSaving(true); setRelayError(false); setMessage("");
    const next = reset ? null : draft.trim();
    try {
      if (next === null) await clearRelayUrl(); else await saveRelayUrl(next);
      setSavedUrl(next); setDraft(next ?? ""); setEditing(false);
      setMessage(reset ? "Relay set to auto-detect" : "Relay address saved");
      refreshInvites();
      editButton.current?.focus();
    } catch { setRelayError(true); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function chooseFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    const version = ++fileVersion.current;
    setFileLoading(true); setFileError(false);
    try {
      const buffer = await file.arrayBuffer();
      let binary = "";
      for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
      const data = `data:${file.type || "audio/mpeg"};base64,${btoa(binary)}`;
      await validateCustomSound(data);
      if (version !== fileVersion.current) return;
      sound.update({ sound: "custom", customPath: file.name, customDataUrl: data });
    } catch { if (version === fileVersion.current) setFileError(true); }
    finally { if (version === fileVersion.current) setFileLoading(false); input.value = ""; }
  }
  const customReady = sound.value.sound !== "custom" || Boolean(validCustom && validCustom === sound.value.customDataUrl);
  const previewDisabled = volume.disabled || sound.disabled || volume.value === 0 || !customReady || fileLoading;
  async function preview() {
    if (previewDisabled) return;
    setPreviewError(false);
    try {
      if (sound.value.sound === "custom") await previewCustomDataUrl(sound.value.customDataUrl!, volume.value);
      else previewSound(sound.value.sound, volume.value);
    } catch { setPreviewError(true); }
  }
  const autoUrl = serverUri ? deriveRelayUrl(serverUri) : null;
  return <>
    <p className="settings-help">These settings apply to all profiles on this device.</p>
    {(volume.status === "error" || sound.status === "error") && <p role="status">Some changes are not saved. <a href="#N2-row">Review invitation sounds</a></p>}
    <SettingsSection id="relay-connection" title="Relay connection">
      {loadState === "loading" && <p role="status">Loading relay settings…</p>}
      {loadState === "error" && <p role="alert">Could not load settings <button onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>}
      {loadState === "ready" && <>
        <p>{savedUrl === null ? "Automatic" : "Custom"}</p>
        <p><code>{savedUrl !== null ? settingsAddress(savedUrl) : autoUrl ? settingsAddress(autoUrl) : "No server selected"}</code></p>
        {savedUrl !== null && <p className="settings-help">Automatic: {autoUrl ? settingsAddress(autoUrl) : "No server selected"}</p>}
        <p role="status">{isRelayConnected ? "Connected to relay" : "Not connected"}</p>
        <button id="relay-edit" ref={editButton} disabled={saving} hidden={editing} onClick={() => { setDraft(savedUrl ?? ""); setEditing(true); setMessage(""); }}>{savedUrl === null ? "Use custom relay URL" : "Edit relay URL"}</button>
        {editing && <form onSubmit={(e) => { e.preventDefault(); void saveRelay(); }}>
          <SettingsRow id="N1" label="Custom relay URL" error={draft && !valid ? "Enter a valid ws:// or wss:// relay address." : undefined}>
            {(props) => <input {...props} autoFocus type="text" value={draft} disabled={saving} onChange={(e) => setDraft(e.target.value)} autoComplete="off" spellCheck={false} />}
          </SettingsRow>
          <div className="settings-actions"><button type="submit" disabled={saving || !dirty || !valid}>{saving ? "Saving…" : "Save"}</button><button type="button" disabled={saving} onClick={cancel}>Cancel</button></div>
        </form>}
        {savedUrl !== null && <button disabled={saving} onClick={() => void saveRelay(true)}>Reset to auto-detect</button>}
        {relayError && <p role="alert" className="settings-error">Could not save relay address. Try again.</p>}
        <p role="status">{message}</p>
      </>}
    </SettingsSection>
    <SettingsSection id="invitation-sounds" title="Invitation sounds">
      {(volume.status === "loading" || sound.status === "loading") && <p role="status">Loading invitation sounds…</p>}
      {(volume.status === "load-error" || sound.status === "load-error") && <p role="alert">Could not load settings <button onClick={() => { if (volume.status === "load-error") volume.retryLoad(); if (sound.status === "load-error") sound.retryLoad(); }}>Retry</button></p>}
      <SettingsRow id="N2" label="Invite notification volume" status={<DeviceSaveStatus {...volume} />}>
        {(props) => <SettingsRange {...props} value={Math.round(volume.value * 100)} min={0} max={100} step={1} disabled={volume.disabled} formatValue={(n) => n === 0 ? "Off" : `${n}%`} onChange={(e) => volume.update(Number(e.target.value) / 100)} />}
      </SettingsRow>
      <div id="N3-row">
        <SettingsChoiceGroup id="N3" legend="Notification sound" value={sound.value.sound} disabled={sound.disabled || fileLoading} options={sounds.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))} onChange={(value) => {
          setFileError(false); setPreviewError(false);
          if (value === "custom") fileInput.current?.click();
          else sound.update({ sound: value as BuiltinSound });
        }} />
        <input ref={fileInput} type="file" accept="audio/*" hidden aria-label="Choose audio file" onChange={(e) => void chooseFile(e.currentTarget)} />
        {fileLoading && <p role="status">Loading audio file…</p>}
        {sound.value.sound === "custom" && <><p>{customReady ? sound.value.customPath || "Custom audio file" : "Choose an audio file"}</p><button disabled={fileLoading} onClick={() => fileInput.current?.click()}>{customReady ? "Replace file" : "Browse audio file"}</button></>}
        {fileError && <p role="alert" className="settings-error">This audio file could not be loaded. Choose another file.</p>}
        <DeviceSaveStatus {...sound} />
      </div>
      <button id="sound-preview" onClick={() => void preview()} disabled={previewDisabled} aria-describedby="sound-preview-help">Preview sound</button>
      <p id="sound-preview-help" className="settings-help">{volume.value === 0 ? "Increase volume to preview." : !customReady ? "Choose an audio file" : "Play the selected invitation sound."}</p>
      {previewError && <p role="alert" className="settings-error">Could not preview sound. Try again.</p>}
    </SettingsSection>
  </>;
}
