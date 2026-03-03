interface SyncIndicatorProps {
  syncStatus: "synced" | "syncing" | "disconnected";
  participantCount: number;
}

function SyncIndicator({ syncStatus, participantCount }: SyncIndicatorProps) {
  const dotColor =
    syncStatus === "synced"
      ? "var(--success)"
      : syncStatus === "syncing"
        ? "var(--accent)"
        : "var(--error)";

  const label =
    syncStatus === "synced"
      ? "Synced"
      : syncStatus === "syncing"
        ? "Syncing..."
        : "Disconnected";

  return (
    <div role="status" aria-live="polite" style={styles.container}>
      <div style={{ ...styles.dot, background: dotColor }} />
      <span style={styles.label}>{label}</span>
      <span style={styles.count}>
        {participantCount} viewer{participantCount !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.25rem 0.5rem",
    background: "rgba(0, 0, 0, 0.6)",
    borderRadius: "4px",
  },
  dot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  label: {
    fontSize: "0.75rem",
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  count: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
    marginLeft: "0.25rem",
  },
};

export default SyncIndicator;
