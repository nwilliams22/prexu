import { useNavigate, useLocation } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";
import LibraryIcon from "./LibraryIcon";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { sections, isLoading } = useLibrary();
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav style={{ ...styles.sidebar, width: collapsed ? 60 : 220 }}>
      <div style={styles.sectionList}>
        {/* Home */}
        <button
          onClick={() => navigate("/")}
          style={{
            ...styles.navItem,
            ...(isActive("/") ? styles.navItemActive : {}),
          }}
          title="Home"
        >
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          {!collapsed && <span style={styles.navLabel}>Home</span>}
        </button>

        {/* Divider */}
        <div style={styles.divider} />

        {/* Library sections */}
        {isLoading &&
          !collapsed &&
          [1, 2, 3].map((i) => (
            <div key={i} style={styles.skeletonItem} />
          ))}

        {sections.map((section) => {
          const path = `/library/${section.key}`;
          return (
            <button
              key={section.key}
              onClick={() => navigate(path)}
              style={{
                ...styles.navItem,
                ...(isActive(path) ? styles.navItemActive : {}),
              }}
              title={section.title}
            >
              <LibraryIcon type={section.type} size={20} />
              {!collapsed && (
                <span style={styles.navLabel}>{section.title}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Collapse toggle */}
      <button onClick={onToggle} style={styles.collapseButton} title="Toggle sidebar">
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: collapsed ? "rotate(180deg)" : "none",
            transition: "transform 0.2s",
          }}
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    background: "var(--bg-secondary)",
    borderRight: "1px solid var(--border)",
    transition: "width 0.2s ease",
    overflow: "hidden",
    flexShrink: 0,
  },
  sectionList: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "0.75rem 0.5rem",
    overflowY: "auto",
    flex: 1,
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.6rem 0.75rem",
    borderRadius: "6px",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    whiteSpace: "nowrap" as const,
    transition: "background 0.15s, color 0.15s",
    width: "100%",
    textAlign: "left" as const,
    minHeight: "38px",
  },
  navItemActive: {
    background: "rgba(229, 160, 13, 0.12)",
    color: "var(--accent)",
  },
  navLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  divider: {
    height: "1px",
    background: "var(--border)",
    margin: "0.5rem 0.75rem",
  },
  skeletonItem: {
    height: "38px",
    borderRadius: "6px",
    background: "var(--border)",
    opacity: 0.3,
    margin: "2px 0",
  },
  collapseButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.75rem",
    background: "transparent",
    color: "var(--text-secondary)",
    borderTop: "1px solid var(--border)",
  },
};

export default Sidebar;
