import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { markAsWatched, markAsUnwatched } from "../services/plex-library";

interface WatchedToggleButtonProps {
  ratingKey: string;
  /** Is the item currently watched? (viewCount > 0) */
  isWatched: boolean;
  /** Called after the toggle completes so the parent can refresh */
  onToggled?: () => void;
}

/**
 * Button to mark a media item as watched or unwatched.
 * Calls the Plex scrobble/unscrobble API and notifies the parent.
 */
function WatchedToggleButton({
  ratingKey,
  isWatched: watched,
  onToggled,
}: WatchedToggleButtonProps) {
  const { server } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (!server || loading) return;
    setLoading(true);
    try {
      if (watched) {
        await markAsUnwatched(server.uri, server.accessToken, ratingKey);
      } else {
        await markAsWatched(server.uri, server.accessToken, ratingKey);
      }
      onToggled?.();
    } catch {
      // Silently fail — API errors are non-critical
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      style={{
        ...styles.button,
        opacity: loading ? 0.6 : 1,
      }}
      disabled={loading}
      title={watched ? "Mark as Unwatched" : "Mark as Watched"}
    >
      {watched ? (
        // Eye-off icon
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginRight: "0.5rem" }}
        >
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        // Checkmark circle icon
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginRight: "0.5rem" }}
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      )}
      {watched ? "Mark Unwatched" : "Mark Watched"}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.65rem 1.5rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.08)",
    color: "var(--text-primary)",
    cursor: "pointer",
    transition: "opacity 0.15s",
  },
};

export default WatchedToggleButton;
