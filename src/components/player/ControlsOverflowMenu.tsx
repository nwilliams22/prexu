/**
 * Overflow "more" menu for the bottom controls bar's right-hand cluster
 * (prexu-52ky) — see `controlsCompaction.ts` for the width thresholds that
 * decide when items collapse in here.
 *
 * Visually reuses TrackMenu's dropdown language (dark translucent panel,
 * bottom-right anchored, same radius/shadow/typography) rather than
 * introducing a new design system, per the responsive-compaction design.
 * Items are plain action buttons (not radio selections like TrackMenu), so
 * this is its own small component rather than a TrackMenu variant.
 */

import { useEffect, useRef } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

export interface ControlsOverflowItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  /** Highlight (accent color) when the underlying feature is active —
   *  mirrors the accent-color treatment ControlsBottomBar already uses
   *  inline for selected subtitle/active enhancement/minimize state. */
  active?: boolean;
  /** Small numeric badge (queue count) — mirrors the inline queue badge. */
  badge?: number;
}

interface ControlsOverflowMenuProps {
  items: ControlsOverflowItem[];
  onClose: () => void;
}

function ControlsOverflowMenu({ items, onClose }: ControlsOverflowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useFocusTrap(menuRef, true);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div
        ref={menuRef}
        role="menu"
        aria-label="More controls"
        style={styles.menu}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item) => (
          <button
            key={item.key}
            role="menuitem"
            onClick={() => {
              item.onClick();
              onClose();
            }}
            style={{
              ...styles.menuItem,
              ...(item.active ? styles.menuItemActive : {}),
            }}
          >
            <span style={styles.icon} aria-hidden="true">
              {item.icon}
            </span>
            <span style={styles.label}>{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span style={styles.badge}>{item.badge}</span>
            )}
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
    pointerEvents: "auto",
  },
  menu: {
    position: "absolute",
    bottom: "60px",
    right: "8px",
    background: "rgba(20, 20, 30, 0.95)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "8px",
    padding: "0.35rem 0",
    minWidth: "180px",
    maxHeight: "300px",
    overflowY: "auto",
    boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
    animation: "popIn 0.15s ease-out",
    transformOrigin: "bottom right",
  },
  menuItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    width: "100%",
    padding: "0.5rem 0.9rem",
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    textAlign: "left",
    borderRadius: 0,
  },
  menuItemActive: {
    color: "var(--accent)",
    fontWeight: 600,
  },
  icon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  label: {
    flex: 1,
  },
  badge: {
    fontSize: "0.65rem",
    fontWeight: 700,
    background: "var(--accent)",
    color: "#000",
    padding: "0px 5px",
    borderRadius: "6px",
    lineHeight: "1.4",
  },
};

export default ControlsOverflowMenu;
