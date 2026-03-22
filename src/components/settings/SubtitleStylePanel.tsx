import { useMemo } from "react";
import type { SubtitleStylePreferences } from "../../types/preferences";
import { styles } from "./settingsStyles";

interface SubtitleStylePanelProps {
  subtitleStyle: SubtitleStylePreferences;
  updateSubtitleStyle: (partial: Partial<SubtitleStylePreferences>) => void;
}

const FONT_OPTIONS = [
  { value: "sans-serif", label: "Sans-serif (Default)" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Monospace" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "'Georgia', serif", label: "Georgia" },
];

export function SubtitleStylePanel({
  subtitleStyle: ss,
  updateSubtitleStyle: update,
}: SubtitleStylePanelProps) {
  const previewStyle = useMemo(() => buildPreviewStyle(ss), [ss]);

  return (
    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>Subtitle Style</h3>

      <div style={styles.field}>
        <label style={styles.label}>Font</label>
        <select
          value={ss.fontFamily}
          onChange={(e) => update({ fontFamily: e.target.value })}
          style={styles.select}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Text Color</label>
        <div style={panelStyles.colorRow}>
          <input
            type="color"
            value={ss.textColor}
            onChange={(e) => update({ textColor: e.target.value })}
            style={panelStyles.colorInput}
            aria-label="Subtitle text color"
          />
          <span style={panelStyles.colorValue}>{ss.textColor}</span>
        </div>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Background Color</label>
        <div style={panelStyles.colorRow}>
          <input
            type="color"
            value={ss.backgroundColor}
            onChange={(e) => update({ backgroundColor: e.target.value })}
            style={panelStyles.colorInput}
            aria-label="Subtitle background color"
          />
          <span style={panelStyles.colorValue}>{ss.backgroundColor}</span>
        </div>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>
          Background Opacity: {Math.round(ss.backgroundOpacity * 100)}%
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={ss.backgroundOpacity}
          onChange={(e) => update({ backgroundOpacity: parseFloat(e.target.value) })}
          style={styles.slider}
          aria-label="Background opacity"
        />
        <div style={styles.sliderLabels}>
          <span>Transparent</span>
          <span>Opaque</span>
        </div>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Outline Color</label>
        <div style={panelStyles.colorRow}>
          <input
            type="color"
            value={ss.outlineColor}
            onChange={(e) => update({ outlineColor: e.target.value })}
            style={panelStyles.colorInput}
            aria-label="Subtitle outline color"
          />
          <span style={panelStyles.colorValue}>{ss.outlineColor}</span>
        </div>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>
          Outline Width: {ss.outlineWidth}px
        </label>
        <input
          type="range"
          min={0}
          max={4}
          step={1}
          value={ss.outlineWidth}
          onChange={(e) => update({ outlineWidth: parseInt(e.target.value) })}
          style={styles.slider}
          aria-label="Outline width"
        />
        <div style={styles.sliderLabels}>
          <span>None</span>
          <span>4px</span>
        </div>
      </div>

      <div style={styles.field}>
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={ss.shadowEnabled}
            onChange={(e) => update({ shadowEnabled: e.target.checked })}
          />
          Drop shadow
        </label>
      </div>

      {/* Live Preview */}
      <div style={styles.field}>
        <label style={styles.label}>Preview</label>
        <div style={panelStyles.previewContainer}>
          <span style={previewStyle}>Sample Subtitle Text</span>
        </div>
      </div>
    </section>
  );
}

function buildPreviewStyle(ss: SubtitleStylePreferences): React.CSSProperties {
  const bgR = parseInt(ss.backgroundColor.slice(1, 3), 16);
  const bgG = parseInt(ss.backgroundColor.slice(3, 5), 16);
  const bgB = parseInt(ss.backgroundColor.slice(5, 7), 16);
  const bgRgba = `rgba(${bgR}, ${bgG}, ${bgB}, ${ss.backgroundOpacity})`;

  const shadows: string[] = [];
  if (ss.outlineWidth > 0) {
    const w = ss.outlineWidth;
    const c = ss.outlineColor;
    shadows.push(
      `${w}px ${w}px 0 ${c}`,
      `-${w}px -${w}px 0 ${c}`,
      `${w}px -${w}px 0 ${c}`,
      `-${w}px ${w}px 0 ${c}`,
    );
  }
  if (ss.shadowEnabled) {
    shadows.push("2px 3px 4px rgba(0, 0, 0, 0.7)");
  }

  return {
    fontFamily: ss.fontFamily,
    color: ss.textColor,
    backgroundColor: bgRgba,
    textShadow: shadows.length > 0 ? shadows.join(", ") : "none",
    fontSize: "1.1rem",
    padding: "4px 8px",
    borderRadius: "2px",
  };
}

const panelStyles: Record<string, React.CSSProperties> = {
  colorRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  colorInput: {
    width: "40px",
    height: "32px",
    padding: 0,
    border: "2px solid var(--border)",
    borderRadius: "6px",
    cursor: "pointer",
    background: "transparent",
  },
  colorValue: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    fontFamily: "monospace",
  },
  previewContainer: {
    background: "#1a1a1a",
    borderRadius: "8px",
    padding: "2rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--border)",
  },
};
