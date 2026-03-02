interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div style={styles.container}>
      <svg
        width={40}
        height={40}
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--error)"
        strokeWidth={1.5}
        style={{ opacity: 0.8 }}
      >
        <circle cx={12} cy={12} r={10} />
        <line x1={12} y1={8} x2={12} y2={12} />
        <line x1={12} y1={16} x2={12.01} y2={16} />
      </svg>
      <p style={styles.message}>{message}</p>
      {onRetry && (
        <button onClick={onRetry} style={styles.retryButton}>
          Retry
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "4rem 2rem",
    gap: "0.75rem",
    textAlign: "center",
  },
  message: {
    margin: 0,
    fontSize: "0.95rem",
    color: "var(--error)",
    maxWidth: "400px",
    lineHeight: 1.5,
  },
  retryButton: {
    marginTop: "0.25rem",
    background: "transparent",
    color: "var(--text-primary)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "0.5rem 1.25rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

export default ErrorState;
