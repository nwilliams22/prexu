/**
 * Activity indicator button for the app header.
 *
 * - Idle: simple tachometer icon
 * - Active: spinning ring animation around the icon
 * - Badge: number of active sessions
 * - Click: toggles the ActivityPanel dropdown
 */

import { useState } from "react";
import { useServerActivity } from "../hooks/useServerActivity";
import ActivityPanel from "./ActivityPanel";

function ActivityButton() {
  const { isActive, sessions } = useServerActivity();
  const [open, setOpen] = useState(false);

  const sessionCount = sessions.length;
  const label = isActive
    ? "Server activity in progress"
    : sessionCount > 0
      ? `${sessionCount} active stream${sessionCount !== 1 ? "s" : ""}`
      : "Server activity";

  return (
    <div style={styles.wrapper}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={styles.button}
        aria-label={label}
        aria-expanded={open}
      >
        {/* Spinning ring (visible only when activities are running) */}
        {isActive && (
          <svg
            width={28}
            height={28}
            viewBox="0 0 28 28"
            style={styles.spinner}
            aria-hidden="true"
          >
            <circle
              cx={14}
              cy={14}
              r={12}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeDasharray="20 56"
              strokeLinecap="round"
            />
          </svg>
        )}

        {/* Activity/tachometer icon */}
        <svg
          width={20}
          height={20}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>

        {/* Session count badge */}
        {sessionCount > 0 && (
          <span style={styles.badge} aria-hidden="true">
            {sessionCount > 9 ? "9+" : sessionCount}
          </span>
        )}
      </button>

      {open && <ActivityPanel onClose={() => setOpen(false)} />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "relative",
  },
  button: {
    position: "relative",
    background: "transparent",
    color: "var(--text-secondary)",
    padding: "0.35rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "6px",
    border: "none",
    cursor: "pointer",
  },
  spinner: {
    position: "absolute",
    inset: 0,
    margin: "auto",
    animation: "spin 1s linear infinite",
    pointerEvents: "none",
  },
  badge: {
    position: "absolute",
    top: "0px",
    right: "-2px",
    minWidth: "16px",
    height: "16px",
    padding: "0 4px",
    fontSize: "0.6rem",
    fontWeight: 700,
    lineHeight: "16px",
    textAlign: "center",
    color: "#000",
    background: "var(--accent)",
    borderRadius: "8px",
    pointerEvents: "none",
  },
};

export default ActivityButton;
