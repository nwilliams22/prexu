import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useInvites } from "../hooks/useInvites";
import { playNotificationSound } from "../utils/notificationSound";
import type { WatchInvite } from "../types/watch-together";

const INVITE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function InviteNotification() {
  const { invites, dismissInvite } = useInvites();
  const [currentIndex, setCurrentIndex] = useState(0);

  // Keep index in bounds
  const safeIndex = Math.min(currentIndex, Math.max(invites.length - 1, 0));

  // Play sound when a new invite arrives
  const [prevCount, setPrevCount] = useState(invites.length);
  useEffect(() => {
    if (invites.length > prevCount) {
      playNotificationSound();
      // Show the newest invite
      setCurrentIndex(invites.length - 1);
    }
    setPrevCount(invites.length);
  }, [invites.length, prevCount]);

  const handleDismiss = useCallback(
    (sessionId: string) => {
      dismissInvite(sessionId);
      setCurrentIndex((i) => Math.max(i - 1, 0));
    },
    [dismissInvite]
  );

  if (invites.length === 0) return null;

  const invite = invites[safeIndex];
  if (!invite) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <InviteCard
          key={invite.sessionId}
          invite={invite}
          onDismiss={() => handleDismiss(invite.sessionId)}
        />

        {/* Multi-invite navigation */}
        {invites.length > 1 && (
          <div style={styles.nav}>
            <button
              onClick={() => setCurrentIndex((i) => Math.max(i - 1, 0))}
              disabled={safeIndex === 0}
              style={{
                ...styles.navButton,
                opacity: safeIndex === 0 ? 0.3 : 1,
              }}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span style={styles.navText}>
              {safeIndex + 1} of {invites.length} invites
            </span>
            <button
              onClick={() =>
                setCurrentIndex((i) => Math.min(i + 1, invites.length - 1))
              }
              disabled={safeIndex === invites.length - 1}
              style={{
                ...styles.navButton,
                opacity: safeIndex === invites.length - 1 ? 0.3 : 1,
              }}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InviteCard({
  invite,
  onDismiss,
}: {
  invite: WatchInvite;
  onDismiss: () => void;
}) {
  const navigate = useNavigate();
  const [remaining, setRemaining] = useState(INVITE_TTL_MS);

  // Countdown timer
  useEffect(() => {
    const elapsed = Date.now() - invite.sentAt;
    const initial = Math.max(INVITE_TTL_MS - elapsed, 0);
    setRemaining(initial);

    const interval = setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          clearInterval(interval);
          onDismiss();
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [invite.sentAt, onDismiss]);

  const handleJoin = () => {
    const params = new URLSearchParams({ session: invite.sessionId });
    if (invite.relayUrl) {
      params.set("relay", invite.relayUrl);
    }
    navigate(`/play/${invite.mediaRatingKey}?${params.toString()}`);
    onDismiss();
  };

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const timeStr = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return (
    <>
      {/* Avatar + sender info */}
      <div style={styles.senderRow}>
        {invite.senderThumb ? (
          <img src={invite.senderThumb} alt="" style={styles.avatar} />
        ) : (
          <div style={styles.avatarPlaceholder}>
            {invite.senderUsername[0]?.toUpperCase()}
          </div>
        )}
        <div style={styles.senderInfo}>
          <span style={styles.senderName}>{invite.senderUsername}</span>
          <span style={styles.inviteLabel}>invited you to watch</span>
        </div>
      </div>

      {/* Media title */}
      <div style={styles.mediaTitle}>{invite.mediaTitle}</div>

      {/* Countdown */}
      <div style={styles.countdown}>
        Session starts in {timeStr}
      </div>

      {/* Actions */}
      <div style={styles.actions}>
        <button onClick={handleJoin} style={styles.joinButton}>
          Join Session
        </button>
        <button onClick={onDismiss} style={styles.declineButton}>
          Decline
        </button>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5000,
  },
  card: {
    background: "var(--bg-secondary)",
    border: "2px solid var(--accent)",
    borderRadius: "16px",
    padding: "2rem",
    width: "400px",
    maxWidth: "90vw",
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
    boxShadow: "0 12px 40px rgba(0, 0, 0, 0.6)",
  },
  senderRow: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
  },
  avatar: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    objectFit: "cover" as const,
    flexShrink: 0,
    border: "2px solid var(--accent)",
  },
  avatarPlaceholder: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    background: "var(--bg-card)",
    border: "2px solid var(--accent)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.25rem",
    fontWeight: 700,
    color: "var(--accent)",
    flexShrink: 0,
  },
  senderInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
  },
  senderName: {
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "var(--accent)",
  },
  inviteLabel: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  mediaTitle: {
    fontSize: "1.25rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    textAlign: "center",
    padding: "0.5rem 0",
  },
  countdown: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    textAlign: "center",
  },
  actions: {
    display: "flex",
    gap: "0.75rem",
    justifyContent: "center",
  },
  joinButton: {
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "8px",
    padding: "0.65rem 2rem",
    fontSize: "0.95rem",
    fontWeight: 700,
    cursor: "pointer",
  },
  declineButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "0.65rem 1.5rem",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.75rem",
    borderTop: "1px solid var(--border)",
    paddingTop: "1rem",
  },
  navButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    cursor: "pointer",
    padding: "0.25rem",
    display: "flex",
  },
  navText: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
  },
};

export default InviteNotification;
