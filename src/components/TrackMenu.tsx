/**
 * Popup menu for selecting subtitle or audio tracks.
 * Positioned above the anchor button.
 */

import { useEffect, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { PlexStream } from "../types/library";

interface TrackMenuProps {
  label: string; // "Subtitles" or "Audio"
  tracks: PlexStream[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  allowNone?: boolean; // true for subtitles
  emptyMessage?: string; // shown when no tracks available
  onClose: () => void;
  /** Show "Search & Download..." link at bottom (for subtitle menus) */
  onSearchDownload?: () => void;
}

function TrackMenu({
  label,
  tracks,
  selectedId,
  onSelect,
  allowNone = false,
  emptyMessage,
  onClose,
  onSearchDownload,
}: TrackMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useFocusTrap(menuRef, true);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Arrow key navigation between menu items
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const menu = menuRef.current;
      if (!menu) return;
      const items = Array.from(
        menu.querySelectorAll<HTMLElement>("button:not([disabled])"),
      );
      if (items.length === 0) return;
      const idx = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown") {
        items[(idx + 1) % items.length].focus();
      } else {
        items[(idx - 1 + items.length) % items.length].focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  const handleSelect = (id: number | null) => {
    onSelect(id);
    onClose();
  };

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div ref={menuRef} role="menu" aria-label={label} style={styles.menu} onClick={(e) => e.stopPropagation()}>
        <div style={styles.menuHeader}>{label}</div>

        {allowNone && (
          <button
            role="menuitemradio"
            aria-checked={selectedId === null}
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
            role="menuitemradio"
            aria-checked={selectedId === track.id}
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

        {/* Empty state when no tracks (and no "None" option either) */}
        {tracks.length === 0 && !allowNone && emptyMessage && (
          <div style={styles.emptyMessage}>{emptyMessage}</div>
        )}

        {/* Search & Download link */}
        {onSearchDownload && (
          <>
            <div style={styles.divider} />
            <button
              onClick={() => {
                onClose();
                onSearchDownload();
              }}
              style={styles.searchLink}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <circle cx={11} cy={11} r={8} />
                <line x1={21} y1={21} x2={16.65} y2={16.65} />
              </svg>
              Search &amp; Download...
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 30,
    pointerEvents: "auto", // override parent's pointerEvents: none
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
  emptyMessage: {
    padding: "0.75rem 1rem",
    fontSize: "0.8rem",
    color: "rgba(255,255,255,0.4)",
    fontStyle: "italic",
  },
  divider: {
    height: "1px",
    background: "rgba(255,255,255,0.1)",
    margin: "0.25rem 0",
  },
  searchLink: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%",
    padding: "0.5rem 1rem",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.8rem",
    textAlign: "left",
    borderRadius: 0,
    cursor: "pointer",
    border: "none",
  },
};

export default TrackMenu;
