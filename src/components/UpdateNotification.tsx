/**
 * Small notification banner shown in the sidebar when an app update
 * is available. Shows version number and an install button.
 */

import { useState } from "react";
import { useAutoUpdate } from "../hooks/useAutoUpdate";

interface UpdateNotificationProps {
  collapsed: boolean;
}

function UpdateNotification({ collapsed }: UpdateNotificationProps) {
  const { updateAvailable, updateVersion, installUpdate } =
    useAutoUpdate();
  const [installing, setInstalling] = useState(false);

  if (!updateAvailable || !updateVersion) return null;

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await installUpdate();
    } catch {
      setInstalling(false);
    }
  };

  if (collapsed) {
    return (
      <button
        onClick={handleInstall}
        disabled={installing}
        style={styles.collapsedBadge}
        title={`Update available: v${updateVersion}`}
        aria-label={`Update available: v${updateVersion}. Click to install.`}
      >
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1={12} y1={15} x2={12} y2={3} />
        </svg>
      </button>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.info}>
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1={12} y1={15} x2={12} y2={3} />
        </svg>
        <span style={styles.label}>v{updateVersion}</span>
      </div>
      <button
        onClick={handleInstall}
        disabled={installing}
        style={{
          ...styles.installButton,
          ...(installing ? { opacity: 0.6 } : {}),
        }}
      >
        {installing ? "Installing..." : "Update"}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    padding: "0.5rem 0.75rem",
    margin: "0 0.5rem 0.5rem",
    borderRadius: "6px",
    background: "rgba(229, 160, 13, 0.1)",
    border: "1px solid rgba(229, 160, 13, 0.2)",
  },
  info: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    color: "var(--accent)",
    minWidth: 0,
  },
  label: {
    fontSize: "0.78rem",
    fontWeight: 500,
    color: "var(--accent)",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  installButton: {
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "4px",
    padding: "0.25rem 0.5rem",
    fontSize: "0.75rem",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  },
  collapsedBadge: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    margin: "0 auto 0.5rem",
    borderRadius: "50%",
    background: "rgba(229, 160, 13, 0.15)",
    color: "var(--accent)",
    border: "none",
    cursor: "pointer",
    padding: 0,
  },
};

export default UpdateNotification;
