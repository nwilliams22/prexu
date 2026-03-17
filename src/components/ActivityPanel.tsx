/**
 * Dropdown panel showing server activities (scans, metadata updates)
 * and active playback sessions.
 */

import { useEffect, useRef } from "react";
import { useServerActivity } from "../hooks/useServerActivity";
import { useAuth } from "../hooks/useAuth";
import { getImageUrl } from "../services/plex-library";
import type { PlexActivity, PlexSession } from "../services/plex-activity";

interface ActivityPanelProps {
  onClose: () => void;
}

function ActivityPanel({ onClose }: ActivityPanelProps) {
  const { activities, sessions } = useServerActivity();
  const { server } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid catching the click that opened the panel
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 50);
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
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const isEmpty = activities.length === 0 && sessions.length === 0;

  return (
    <div ref={panelRef} style={styles.panel} role="dialog" aria-label="Server activity">
      <h3 style={styles.heading}>Activity</h3>

      {isEmpty && (
        <p style={styles.emptyText}>No active tasks or streams.</p>
      )}

      {/* Running activities */}
      {activities.length > 0 && (
        <section>
          <h4 style={styles.sectionTitle}>Tasks</h4>
          {activities.map((act) => (
            <ActivityRow key={act.uuid} activity={act} />
          ))}
        </section>
      )}

      {/* Active sessions */}
      {sessions.length > 0 && (
        <section style={activities.length > 0 ? { marginTop: "0.75rem" } : undefined}>
          <h4 style={styles.sectionTitle}>Now Playing</h4>
          {sessions.map((sess, i) => (
            <SessionRow
              key={sess.ratingKey ?? i}
              session={sess}
              serverUri={server?.uri ?? ""}
              serverToken={server?.accessToken ?? ""}
            />
          ))}
        </section>
      )}
    </div>
  );
}

// ── Activity row ──

function ActivityRow({ activity }: { activity: PlexActivity }) {
  return (
    <div style={styles.activityRow}>
      <div style={styles.activityHeader}>
        <span style={styles.rowTitle}>{activity.title}</span>
        <span style={styles.progressLabel}>{Math.round(Math.max(0, activity.progress))}%</span>
      </div>
      {activity.subtitle && (
        <span style={styles.rowSub}>{activity.subtitle}</span>
      )}
      <div style={styles.activityProgressTrack}>
        <div
          style={{
            ...styles.progressFill,
            width: `${Math.max(2, Math.max(0, activity.progress))}%`,
          }}
        />
      </div>
    </div>
  );
}

// ── Session row ──

function SessionRow({
  session,
  serverUri,
  serverToken,
}: {
  session: PlexSession;
  serverUri: string;
  serverToken: string;
}) {
  const thumb = session.grandparentThumb || session.thumb;
  const imgUrl = thumb
    ? getImageUrl(serverUri, serverToken, thumb, 80, 80)
    : undefined;

  const title =
    session.grandparentTitle
      ? `${session.grandparentTitle} — ${session.title}`
      : session.title;

  const state = session.Player?.state ?? "unknown";
  const user = session.User?.title ?? "Unknown";
  const player = session.Player?.product ?? session.Player?.platform ?? "";

  const progress =
    session.duration && session.viewOffset
      ? Math.round((session.viewOffset / session.duration) * 100)
      : undefined;

  return (
    <div style={styles.row}>
      {imgUrl && <img src={imgUrl} style={styles.sessionThumb} alt="" />}
      <div style={styles.rowInfo}>
        <span style={styles.rowTitle}>{title}</span>
        <span style={styles.rowSub}>
          {user} · {player}
          {state === "paused" ? " · Paused" : ""}
        </span>
        {progress !== undefined && (
          <div style={{ ...styles.progressTrack, marginTop: "4px" }}>
            <div
              style={{
                ...styles.progressFill,
                width: `${progress}%`,
                background: state === "paused" ? "var(--text-secondary)" : "var(--accent)",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: "8px",
    width: "320px",
    maxHeight: "400px",
    overflowY: "auto",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    padding: "0.75rem",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    zIndex: 200,
  },
  heading: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: "0 0 0.5rem 0",
  },
  sectionTitle: {
    fontSize: "0.65rem",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--text-secondary)",
    margin: "0 0 0.4rem 0",
  },
  emptyText: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    textAlign: "center",
    padding: "1rem 0",
    margin: 0,
  },
  activityRow: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    padding: "0.4rem 0",
  },
  activityHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
  },
  activityProgressTrack: {
    width: "100%",
    height: "3px",
    background: "rgba(255,255,255,0.08)",
    borderRadius: "2px",
    overflow: "hidden",
    marginTop: "2px",
  },
  row: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    padding: "0.4rem 0",
  },
  rowInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    minWidth: 0,
  },
  rowTitle: {
    fontSize: "0.78rem",
    fontWeight: 500,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rowSub: {
    fontSize: "0.68rem",
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  progressTrack: {
    flex: "0 0 auto",
    width: "100%",
    height: "3px",
    background: "rgba(255,255,255,0.08)",
    borderRadius: "2px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "var(--accent)",
    borderRadius: "2px",
    transition: "width 0.3s ease",
  },
  progressLabel: {
    fontSize: "0.65rem",
    color: "var(--text-secondary)",
    flexShrink: 0,
    minWidth: "28px",
    textAlign: "right",
  },
  sessionThumb: {
    width: "36px",
    height: "36px",
    borderRadius: "4px",
    objectFit: "cover",
    flexShrink: 0,
  },
};

export default ActivityPanel;
