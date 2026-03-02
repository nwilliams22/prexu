/**
 * Popup menu for selecting subtitle or audio tracks.
 * Positioned above the anchor button.
 */

import type { PlexStream } from "../types/library";

interface TrackMenuProps {
  label: string; // "Subtitles" or "Audio"
  tracks: PlexStream[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  allowNone?: boolean; // true for subtitles
  onClose: () => void;
}

function TrackMenu({
  label,
  tracks,
  selectedId,
  onSelect,
  allowNone = false,
  onClose,
}: TrackMenuProps) {
  const handleSelect = (id: number | null) => {
    onSelect(id);
    onClose();
  };

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.menu} onClick={(e) => e.stopPropagation()}>
        <div style={styles.menuHeader}>{label}</div>

        {allowNone && (
          <button
            onClick={() => handleSelect(null)}
            style={{
              ...styles.menuItem,
              ...(selectedId === null ? styles.menuItemSelected : {}),
            }}
          >
            <span style={styles.checkmark}>
              {selectedId === null ? "✓" : ""}
            </span>
            <span>None</span>
          </button>
        )}

        {tracks.map((track) => (
          <button
            key={track.id}
            onClick={() => handleSelect(track.id)}
            style={{
              ...styles.menuItem,
              ...(selectedId === track.id ? styles.menuItemSelected : {}),
            }}
          >
            <span style={styles.checkmark}>
              {selectedId === track.id ? "✓" : ""}
            </span>
            <span>{track.displayTitle}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 30,
  },
  menu: {
    position: "absolute",
    bottom: "80px",
    right: "60px",
    background: "rgba(20, 20, 30, 0.95)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "8px",
    padding: "0.5rem 0",
    minWidth: "220px",
    maxHeight: "300px",
    overflowY: "auto",
    boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
    animation: "popIn 0.15s ease-out",
    transformOrigin: "bottom right",
  },
  menuHeader: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "rgba(255,255,255,0.5)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    padding: "0.5rem 1rem 0.25rem",
  },
  menuItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%",
    padding: "0.5rem 1rem",
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    textAlign: "left",
    borderRadius: 0,
  },
  menuItemSelected: {
    color: "var(--accent)",
    fontWeight: 600,
  },
  checkmark: {
    width: "16px",
    fontSize: "0.85rem",
    flexShrink: 0,
  },
};

export default TrackMenu;
