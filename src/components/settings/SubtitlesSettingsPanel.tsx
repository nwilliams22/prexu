import { SettingsColor } from "./SettingsColor";
import type { PlaybackPreferences, SubtitleStylePreferences } from "../../types/preferences";
import { LANGUAGES } from "../../constants/languages";
import { PreferenceRow } from "./PreferenceRow";
import { SettingsRange, SettingsSection } from "./SettingsPrimitives";
import { FONT_OPTIONS, buildPreviewStyle } from "./SubtitleStylePanel";

interface SubtitlesSettingsPanelProps {
  playback: PlaybackPreferences;
  updatePlayback: (partial: Partial<PlaybackPreferences>) => void;
  updateSubtitleStyle: (partial: Partial<SubtitleStylePreferences>) => void;
}

export function SubtitlesSettingsPanel({ playback: pb, updatePlayback, updateSubtitleStyle: update }: SubtitlesSettingsPanelProps) {
  const ss = pb.subtitleStyle;
  const off = pb.defaultSubtitles === "off";
  return <>
    <SettingsSection title="Defaults">
      <PreferenceRow path="playback.defaultSubtitles">
        {(props) => <select {...props} value={pb.defaultSubtitles} onChange={(e) => updatePlayback({ defaultSubtitles: e.target.value as PlaybackPreferences["defaultSubtitles"] })}>
          <option value="auto">Auto (use server default)</option><option value="always">Always on</option><option value="off">Off</option>
        </select>}
      </PreferenceRow>
      <PreferenceRow path="playback.preferredSubtitleLanguage" help={off ? "Turn on default subtitles to choose a preferred language." : undefined}>
        {(props) => <select {...props} disabled={off} value={pb.preferredSubtitleLanguage} onChange={(e) => updatePlayback({ preferredSubtitleLanguage: e.target.value })}>
          {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.code ? language.label : "No preference"}</option>)}
        </select>}
      </PreferenceRow>
    </SettingsSection>
    <SettingsSection title="Appearance" description={off ? "Saved for when subtitles are enabled." : undefined}>
      <div className="settings-subtitle-preview"><span style={{ ...buildPreviewStyle(ss), fontSize: `${1.1 * pb.subtitleSize / 100}rem` }}>Sample subtitle text</span></div>
      <p id="subtitle-preview" tabIndex={-1} className="settings-help">This preview illustrates chosen styling, not a guarantee for all subtitle formats.</p>
      <PreferenceRow path="playback.subtitleSize">
        {(props) => <SettingsRange {...props} value={pb.subtitleSize} min={50} max={200} step={10} formatValue={(n) => `${n}%`} onChange={(e) => updatePlayback({ subtitleSize: Number(e.target.value) })} />}
      </PreferenceRow>
      <PreferenceRow path="playback.subtitleStyle.fontFamily">
        {(props) => <select {...props} value={ss.fontFamily} onChange={(e) => update({ fontFamily: e.target.value })}>
          {FONT_OPTIONS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
        </select>}
      </PreferenceRow>
      {(["textColor", "backgroundColor"] as const).map((key) => <PreferenceRow key={key} path={`playback.subtitleStyle.${key}`}>
        {(props) => <SettingsColor {...props} value={ss[key]} onChange={(value) => update({ [key]: value })} />}
      </PreferenceRow>)}
      <PreferenceRow path="playback.subtitleStyle.backgroundOpacity">
        {(props) => <SettingsRange {...props} value={ss.backgroundOpacity} min={0} max={1} step={0.05} formatValue={(n) => `${Math.round(n * 100)}%`} onChange={(e) => update({ backgroundOpacity: Number(e.target.value) })} />}
      </PreferenceRow>
      <PreferenceRow path="playback.subtitleStyle.outlineColor">
        {(props) => <SettingsColor {...props} value={ss.outlineColor} onChange={(value) => update({ outlineColor: value })} />}
      </PreferenceRow>
      <PreferenceRow path="playback.subtitleStyle.outlineWidth">
        {(props) => <SettingsRange {...props} value={ss.outlineWidth} min={0} max={4} step={1} formatValue={(n) => `${n}px`} onChange={(e) => update({ outlineWidth: Number(e.target.value) })} />}
      </PreferenceRow>
      <PreferenceRow path="playback.subtitleStyle.shadowEnabled">
        {(props) => <input {...props} type="checkbox" checked={ss.shadowEnabled} onChange={(e) => update({ shadowEnabled: e.target.checked })} />}
      </PreferenceRow>
    </SettingsSection>
  </>;
}
