import { useDownloads } from "../../hooks/useDownloads";
import { SettingsSection, SettingsRow } from "./SettingsPrimitives";

export function DownloadSettingsPanel() {
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
    </SettingsSection>
  );
}
