import type { WatchParticipant } from "../types/watch-together";

interface ParticipantOverlayProps {
  participants: WatchParticipant[];
  visible: boolean;
}

function ParticipantOverlay({
  participants,
  visible,
}: ParticipantOverlayProps) {
  if (!visible || participants.length === 0) return null;

  return (
    <div style={styles.container}>
      {participants.map((p) => {
        const borderColor =
          p.state === "playing"
            ? "#4caf50"
            : p.state === "buffering"
              ? "var(--accent)"
              : "#666";

        return (
          <div key={p.plexUsername} style={styles.avatarWrapper} title={p.plexUsername}>
            {p.plexThumb ? (
              <img
                src={p.plexThumb}
                alt={p.plexUsername}
                style={{
                  ...styles.avatar,
                  borderColor,
                }}
              />
            ) : (
              <div
                style={{
                  ...styles.avatarPlaceholder,
                  borderColor,
                }}
              >
                {p.plexUsername[0]?.toUpperCase()}
              </div>
            )}
            {p.isHost && <span style={styles.hostBadge}>★</span>}
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    top: "60px",
    right: "16px",
    display: "flex",
    gap: "0.5rem",
    zIndex: 20,
  },
  avatarWrapper: {
    position: "relative",
  },
  avatar: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    objectFit: "cover" as const,
    border: "2px solid",
  },
  avatarPlaceholder: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    border: "2px solid",
    background: "var(--bg-card)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  hostBadge: {
    position: "absolute",
    bottom: "-2px",
    right: "-2px",
    fontSize: "0.6rem",
    color: "var(--accent)",
    background: "var(--bg-primary)",
    borderRadius: "50%",
    width: "14px",
    height: "14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};

export default ParticipantOverlay;
