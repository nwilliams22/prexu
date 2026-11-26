import { useEffect, useState } from "react";
import { getDownloadsDir, chooseDownloadsFolder, moveDownloadsFolder, onDownloadMoveProgress, type DownloadMoveProgress } from "../../services/downloads";
import { useDownloads } from "../../hooks/useDownloads";
import { SettingsRow } from "./SettingsPrimitives";

export function DownloadFolderSetting() {
  const { pauseAll } = useDownloads();
  const [folder, setFolder] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<DownloadMoveProgress | null>(null);
  useEffect(() => {
    let alive = true;
    void getDownloadsDir().then((path) => { if (alive) setFolder(path); }).catch((e: unknown) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, []);
  async function choose() {
    setBusy(true);
    setError("");
    try { setSelected(await chooseDownloadsFolder()); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function move() {
    if (!selected) return;
    setBusy(true);
    setError("");
    setMessage("Pausing downloads and preparing the move…");
    let stop: (() => void) | undefined;
    try {
      stop = await onDownloadMoveProgress(setProgress);
      pauseAll();
      setFolder(await moveDownloadsFolder(selected));
      setSelected(null);
      setMessage("Downloads moved and verified. Resume paused downloads from Downloads when ready.");
    } catch (e) {
      setError(String(e));
      setMessage("The original download folder is still in use. Downloads remain paused.");
    } finally {
      stop?.();
      setBusy(false);
      setProgress(null);
    }
  }
  return <SettingsRow id="download-folder" label="Download folder"
    help="Choose an empty folder. Prexu creates a folder inside it and moves existing downloads there. Downloads pause during the move."
    error={error} status={<div aria-live="polite">{message}{progress && <><progress aria-label="Moving downloads" value={progress.copiedBytes} max={Math.max(1, progress.totalBytes)} /><span> Copying and verifying downloads…</span></>}</div>}>
    {(props) => <div>
      <p style={{ overflowWrap: "anywhere" }}>{folder}</p>
      <button {...props} type="button" disabled={busy} onClick={() => void choose()}>Choose folder…</button>
      {selected && <div>
        <p style={{ overflowWrap: "anywhere" }}>Move downloads to {selected}?</p>
        <button type="button" disabled={busy} onClick={() => void move()}>Move downloads</button>
        <button type="button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button>
      </div>}
    </div>}
  </SettingsRow>;
}
