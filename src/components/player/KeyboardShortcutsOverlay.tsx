/**
 * Modal overlay showing all available player keyboard shortcuts.
 * Triggered by pressing '?' in the player.
 */

interface KeyboardShortcutsOverlayProps {
  visible: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  key: string;
  description: string;
}

const SHORTCUTS: { category: string; entries: ShortcutEntry[] }[] = [
  {
    category: "Playback",
    entries: [
      { key: "Space / K", description: "Play / Pause" },
      { key: "←", description: "Seek back 10s" },
      { key: "→", description: "Seek forward 10s" },
      { key: "Shift + ←", description: "Previous chapter / 30s back" },
      { key: "Shift + →", description: "Next chapter / 30s forward" },
      { key: "Shift + N", description: "Next episode" },
      { key: "Shift + P", description: "Previous episode" },
    ],
  },
  {
    category: "Volume",
    entries: [
      { key: "↑", description: "Volume up" },
      { key: "↓", description: "Volume down" },
      { key: "M", description: "Toggle mute" },
      { key: "[", description: "Decrease volume boost" },
      { key: "]", description: "Increase volume boost" },
      { key: "N", description: "Cycle normalization preset" },
    ],
  },
  {
    category: "Display",
    entries: [
      { key: "F", description: "Toggle fullscreen" },
      { key: "P", description: "Toggle Picture-in-Picture" },
      { key: "Esc", description: "Exit fullscreen / Go back" },
    ],
  },
  {
    category: "Other",
    entries: [
      { key: "?", description: "Show/hide this help" },
    ],
  },
];

export default function KeyboardShortcutsOverlay({
  visible,
  onClose,
}: KeyboardShortcutsOverlayProps) {
  if (!visible) return null;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Keyboard Shortcuts</h2>
          <button style={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>
        <div style={styles.content}>
          {SHORTCUTS.map((group) => (
            <div key={group.category} style={styles.category}>
              <h3 style={styles.categoryTitle}>{group.category}</h3>
              {group.entries.map((entry) => (
                <div key={entry.key} style={styles.row}>
                  <kbd style={styles.key}>{entry.key}</kbd>
                  <span style={styles.description}>{entry.description}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "absolute",
    inset: 0,
    background: "rgba(0, 0, 0, 0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  modal: {
    background: "rgba(30, 30, 30, 0.95)",
    borderRadius: 12,
    padding: "24px 32px",
    maxWidth: 560,
    width: "90%",
    maxHeight: "80vh",
    overflowY: "auto" as const,
    border: "1px solid rgba(255, 255, 255, 0.1)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: "#fff",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#888",
    fontSize: 18,
    cursor: "pointer",
    padding: "4px 8px",
  },
  content: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 24,
  },
  category: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  categoryTitle: {
    margin: "0 0 8px 0",
    fontSize: 13,
    fontWeight: 600,
    color: "#e5a00d",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  key: {
    background: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 12,
    fontFamily: "monospace",
    color: "#ddd",
    minWidth: 60,
    textAlign: "center" as const,
    whiteSpace: "nowrap" as const,
  },
  description: {
    fontSize: 13,
    color: "#bbb",
  },
};
