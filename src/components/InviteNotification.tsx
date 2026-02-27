import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useInvites } from "../hooks/useInvites";
import type { WatchInvite } from "../types/watch-together";

function InviteNotification() {
  const { invites, dismissInvite, refreshInvites, isRelayConnected } =
    useInvites();

  if (invites.length === 0) return null;

  return (
    <div style={styles.container}>
      {invites.map((invite) => (
        <InviteBanner
          key={invite.sessionId}
          invite={invite}
          onDismiss={() => dismissInvite(invite.sessionId)}
        />
      ))}
      {!isRelayConnected && (
        <button onClick={refreshInvites} style={styles.refreshButton}>
          Reconnect to relay
        </button>
      )}
    </div>
  );
}

function InviteBanner({
  invite,
  onDismiss,
}: {
  invite: WatchInvite;
  onDismiss: () => void;
}) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(true);

  // Auto-dismiss after 60 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, 60000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!visible) return null;

  const handleJoin = () => {
    navigate(
      `/play/${invite.mediaRatingKey}?session=${invite.sessionId}`
    );
    onDismiss();
  };

  return (
    <div style={styles.banner}>
      {invite.senderThumb && (
        <img
          src={invite.senderThumb}
          alt=""
          style={styles.avatar}
        />
      )}
      <div style={styles.bannerText}>
        <span style={styles.sender}>{invite.senderUsername}</span>
        {" invited you to watch "}
        <span style={styles.mediaTitle}>{invite.mediaTitle}</span>
      </div>
      <div style={styles.bannerActions}>
        <button onClick={handleJoin} style={styles.joinButton}>
          Join
        </button>
        <button onClick={onDismiss} style={styles.dismissButton}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    padding: "0.5rem 1rem",
  },
  banner: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    background: "var(--bg-card)",
    border: "1px solid var(--accent)",
    borderRadius: "8px",
    animation: "fadeIn 0.3s ease",
  },
  avatar: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    objectFit: "cover" as const,
    flexShrink: 0,
  },
  bannerText: {
    flex: 1,
    fontSize: "0.9rem",
    color: "var(--text-primary)",
  },
  sender: {
    fontWeight: 600,
    color: "var(--accent)",
  },
  mediaTitle: {
    fontWeight: 600,
  },
  bannerActions: {
    display: "flex",
    gap: "0.5rem",
    flexShrink: 0,
  },
  joinButton: {
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "6px",
    padding: "0.4rem 1rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  dismissButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "0.4rem 0.75rem",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  refreshButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    fontSize: "0.8rem",
    textDecoration: "underline",
    cursor: "pointer",
    alignSelf: "center",
    padding: "0.25rem",
  },
};

export default InviteNotification;
