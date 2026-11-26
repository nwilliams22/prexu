import { useAutoDeleteDownloads } from "../../hooks/useAutoDeleteDownloads";
import { useDownloads } from "../../hooks/useDownloads";
import { SettingsSection, SettingsRow } from "./SettingsPrimitives";

export function DownloadSettingsPanel() {
  const [autoDelete, setAutoDelete] = useAutoDeleteDownloads();
  const { concurrency, setConcurrency } = useDownloads();
  return (
    <SettingsSection title="Downloads">
      <SettingsRow id="download-concurrency" label="Simultaneous downloads" help="Applies to this device. Lower limits take effect as current downloads finish.">
        {(props) => <select {...props} value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))}>
          <option value={1}>1 (default)</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
        </select>}
      </SettingsRow>
      <SettingsRow id="download-auto-delete" label="Auto-delete watched downloads" help="Off by default. Remove watched downloads on the next app launch or after 24 hours. Downloads watched in this app session are kept until the next launch. Requires a connection to their server.">
        {(props) => <input {...props} type="checkbox" checked={autoDelete} onChange={(event) => setAutoDelete(event.target.checked)} />}
      </SettingsRow>
    </SettingsSection>
  );
}
