import { useRef, useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { AudioEnhancementsResult } from "../hooks/useAudioEnhancements";
import type { NormalizationPreset } from "../types/preferences";

interface AudioEnhancementsPanelProps {
  enhancements: AudioEnhancementsResult;
  onClose: () => void;
  onPersist: (changes: {
    volumeBoost?: number;
    normalizationPreset?: NormalizationPreset;
    audioOffsetMs?: number;
  }) => void;
}

const PRESET_LABELS: { key: NormalizationPreset; label: string }[] = [
  { key: "off", label: "Off" },
  { key: "light", label: "Light" },
  { key: "night", label: "Night" },
];

function AudioEnhancementsPanel({
  enhancements,
  onClose,
  onPersist,
}: AudioEnhancementsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div style={styles.backdrop} onClick={onClose} aria-hidden="true">
      <div
        ref={panelRef}
        style={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Audio enhancements"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={styles.title}>Audio Enhancements</h3>

        {/* Gain */}
        <div style={styles.section}>
          <div style={styles.offsetHeader}>
            <label style={styles.sectionLabel}>
              Gain: {Math.round(enhancements.volumeBoost * 100)}%
            </label>
            {enhancements.volumeBoost !== 1 && (
              <button
                style={styles.resetButton}
                onClick={() => {
                  enhancements.setVolumeBoost(1);
                  onPersist({ volumeBoost: 1 });
                }}
              >
                Reset
              </button>
            )}
          </div>
          <input
            type="range"
            aria-label="Audio gain"
            min={0.25}
            max={3}
            step={0.25}
            value={enhancements.volumeBoost}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              enhancements.setVolumeBoost(val);
              onPersist({ volumeBoost: val });
            }}
            style={styles.slider}
          />
          <div style={styles.sliderLabels}>
            <span>25%</span>
            <span>100%</span>
            <span>300%</span>
          </div>
          <p style={styles.hint}>
            Reduce or amplify audio beyond the main volume slider.
          </p>
        </div>

        {/* Normalization */}
        <div style={styles.section}>
          <span style={styles.sectionLabel}>Normalization</span>
          <div style={styles.presetRow}>
            {PRESET_LABELS.map(({ key, label }) => (
              <button
                key={key}
                style={{
                  ...styles.presetButton,
                  ...(enhancements.normalizationPreset === key
                    ? styles.presetButtonActive
                    : {}),
                }}
                aria-pressed={enhancements.normalizationPreset === key}
                onClick={() => {
                  enhancements.setNormalizationPreset(key);
                  onPersist({ normalizationPreset: key });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Audio Offset */}
        <div style={styles.section}>
          <div style={styles.offsetHeader}>
            <label style={styles.sectionLabel}>
              Audio Offset: {enhancements.audioOffsetMs}ms
            </label>
            {enhancements.audioOffsetMs > 0 && (
              <button
                style={styles.resetButton}
                onClick={() => {
                  enhancements.setAudioOffsetMs(0);
                  onPersist({ audioOffsetMs: 0 });
                }}
              >
                Reset
              </button>
            )}
          </div>
          <input
            type="range"
            aria-label="Audio offset"
            min={0}
            max={500}
            step={10}
            value={enhancements.audioOffsetMs}
            onChange={(e) => {
              const val = Number(e.target.value);
              enhancements.setAudioOffsetMs(val);
              onPersist({ audioOffsetMs: val });
            }}
            style={styles.slider}
          />
          <div style={styles.sliderLabels}>
            <span>0ms</span>
            <span>250ms</span>
            <span>500ms</span>
          </div>
          <p style={styles.hint}>
            Delays audio to fix lip sync when audio plays ahead of video.
          </p>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    pointerEvents: "auto", // override parent's pointerEvents: none
  },
  panel: {
    position: "absolute",
    bottom: "80px",
    right: "100px",
    background: "rgba(20, 20, 30, 0.95)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "8px",
    padding: "1rem",
    minWidth: "260px",
    maxWidth: "300px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
    backdropFilter: "blur(12px)",
  },
  title: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: "0 0 0.75rem 0",
  },
  section: {
    marginBottom: "0.75rem",
  },
  sectionLabel: {
    display: "block",
    fontSize: "0.75rem",
    fontWeight: 500,
    color: "rgba(255,255,255,0.7)",
    marginBottom: "0.4rem",
  },
  slider: {
    width: "100%",
    accentColor: "var(--accent)",
    cursor: "pointer",
  },
  sliderLabels: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "0.65rem",
    color: "rgba(255,255,255,0.35)",
    marginTop: "0.15rem",
  },
  presetRow: {
    display: "flex",
    gap: "0.4rem",
  },
  presetButton: {
    flex: 1,
    padding: "0.35rem 0.5rem",
    fontSize: "0.75rem",
    fontWeight: 500,
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.7)",
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
  },
  presetButtonActive: {
    background: "var(--accent)",
    color: "#000",
    borderColor: "var(--accent)",
    fontWeight: 600,
  },
  offsetHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resetButton: {
    fontSize: "0.65rem",
    color: "var(--accent)",
    background: "transparent",
    padding: "0.15rem 0.4rem",
    borderRadius: "4px",
    cursor: "pointer",
    border: "1px solid rgba(229,160,13,0.3)",
  },
  hint: {
    fontSize: "0.65rem",
    color: "rgba(255,255,255,0.35)",
    lineHeight: 1.4,
    marginTop: "0.3rem",
  },
};

export default AudioEnhancementsPanel;
