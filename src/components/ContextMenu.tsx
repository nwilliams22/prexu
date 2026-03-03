import { useEffect, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  dividerAbove?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useFocusTrap(menuRef, true);

  // Close on outside click (setTimeout prevents the opening click from closing)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

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

  // Adjust position to stay within viewport
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      el.style.left = `${position.x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${position.y - rect.height}px`;
    }
  }, [position]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        ...styles.menu,
        left: position.x,
        top: position.y,
      }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.dividerAbove && <div style={styles.divider} />}
          <button
            role="menuitem"
            data-context-menu-item
            style={{
              ...styles.menuItem,
              opacity: item.disabled ? 0.4 : 1,
              cursor: item.disabled ? "default" : "pointer",
            }}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  menu: {
    position: "fixed",
    zIndex: 1200,
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "4px 0",
    minWidth: "200px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
    animation: "popIn 0.12s ease-out",
    transformOrigin: "top left",
  },
  menuItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 14px",
    fontSize: "0.85rem",
    color: "var(--text-primary)",
    background: "transparent",
    border: "none",
    whiteSpace: "nowrap",
  },
  divider: {
    height: "1px",
    background: "var(--border)",
    margin: "4px 0",
  },
};

export default ContextMenu;
