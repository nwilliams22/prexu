/**
 * Notification bell icon for the header.
 * Shows a red badge with unread content request count.
 */

import { useNavigate } from "react-router-dom";
import { useContentRequests } from "../hooks/useContentRequests";

function RequestBell() {
  const navigate = useNavigate();
  const { unreadCount } = useContentRequests();

  const label =
    unreadCount > 0
      ? `Content requests, ${unreadCount} unread`
      : "Content requests";

  return (
    <button
      onClick={() => navigate("/requests")}
      style={styles.button}
      aria-label={label}
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
        aria-hidden="true"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>

      {unreadCount > 0 && (
        <span style={styles.badge} aria-hidden="true">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    position: "relative",
    background: "transparent",
    color: "var(--text-secondary)",
    padding: "0.35rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "6px",
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
    color: "#fff",
    background: "#e53935",
    borderRadius: "8px",
    pointerEvents: "none",
  },
};

export default RequestBell;
