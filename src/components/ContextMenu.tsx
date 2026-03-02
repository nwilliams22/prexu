import { useEffect, useRef } from "react";

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
    zIndex: 9999,
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "4px 0",
    minWidth: "200px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
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
