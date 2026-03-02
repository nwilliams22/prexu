import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useLibrary } from "../hooks/useLibrary";
import {
  scanLibrary,
  refreshLibraryMetadata,
  emptyLibraryTrash,
} from "../services/plex-library";
import LibraryIcon from "./LibraryIcon";
import ContextMenu from "./ContextMenu";
import type { ContextMenuItem } from "./ContextMenu";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface SectionMenuState {
  position: { x: number; y: number };
  sectionKey: string;
}

function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { server } = useAuth();
  const { sections, isLoading } = useLibrary();
  const navigate = useNavigate();
  const location = useLocation();
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<SectionMenuState | null>(null);

  const isActive = (path: string) => location.pathname === path;

  const openSectionMenu = (e: React.MouseEvent, sectionKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, sectionKey });
  };

  const buildSectionMenuItems = (sectionKey: string): ContextMenuItem[] => {
    if (!server) return [];
    return [
      {
        label: "Scan Library Files",
        onClick: async () => {
          await scanLibrary(server.uri, server.accessToken, sectionKey);
        },
      },
      {
        label: "Refresh All Metadata",
        onClick: async () => {
          await refreshLibraryMetadata(server.uri, server.accessToken, sectionKey);
        },
      },
      {
        label: "Empty Trash",
        dividerAbove: true,
        onClick: async () => {
          await emptyLibraryTrash(server.uri, server.accessToken, sectionKey);
        },
      },
    ];
  };

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
          const isHovered = hoveredSection === section.key;
          return (
            <div
              key={section.key}
              style={styles.sectionWrapper}
              onMouseEnter={() => setHoveredSection(section.key)}
              onMouseLeave={() => setHoveredSection(null)}
            >
              <button
                onClick={() => navigate(path)}
                onContextMenu={(e) => openSectionMenu(e, section.key)}
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
              {/* Three-dot menu button (non-collapsed, hovered) */}
              {!collapsed && isHovered && (
                <button
                  onClick={(e) => openSectionMenu(e, section.key)}
                  style={styles.sectionMoreBtn}
                  aria-label="Library options"
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </button>
              )}
            </div>
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

      {/* Section context menu */}
      {contextMenu && (
        <ContextMenu
          items={buildSectionMenuItems(contextMenu.sectionKey)}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}
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
  sectionWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  sectionMoreBtn: {
    position: "absolute",
    right: "6px",
    width: "24px",
    height: "24px",
    borderRadius: "4px",
    background: "rgba(255, 255, 255, 0.08)",
    color: "var(--text-secondary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: "none",
    cursor: "pointer",
    zIndex: 1,
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
