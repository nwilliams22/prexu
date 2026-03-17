/**
 * Error overlay shown when video playback fails.
 * Provides retry and go-back options.
 */

interface ErrorOverlayProps {
  error: string;
  onRetry: () => void;
  onBack: () => void;
}

function ErrorOverlay({ error, onRetry, onBack }: ErrorOverlayProps) {
  return (
    <div style={styles.errorOverlay}>
      <p style={styles.errorText}>
        {error.split("\n")[0]}
      </p>
      {error.includes("\n") && (
        <pre style={styles.errorDetails}>
          {error.split("\n").slice(1).join("\n")}
        </pre>
      )}
      <div style={styles.errorButtons}>
        <button onClick={onRetry} style={styles.retryButton}>
          Retry
        </button>
        <button onClick={onBack} style={styles.errorBackButton}>
          Go Back
        </button>
      </div>
    </div>
  );
}

export default ErrorOverlay;

const styles: Record<string, React.CSSProperties> = {
  errorOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    background: "rgba(0,0,0,0.85)",
    zIndex: 20,
  },
  errorText: {
    color: "var(--error)",
    fontSize: "1rem",
    textAlign: "center",
    maxWidth: "400px",
  },
  errorDetails: {
    color: "rgba(255,255,255,0.5)",
    fontSize: "0.7rem",
    fontFamily: "monospace",
    textAlign: "left" as const,
    maxWidth: "500px",
    padding: "0.5rem 0.75rem",
    background: "rgba(255,255,255,0.05)",
    borderRadius: "6px",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    maxHeight: "120px",
    overflow: "auto",
  },
  errorButtons: {
    display: "flex",
    gap: "0.75rem",
  },
  retryButton: {
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.9rem",
    fontWeight: 600,
    padding: "0.5rem 1.25rem",
    borderRadius: "8px",
  },
  errorBackButton: {
    background: "rgba(255,255,255,0.15)",
    color: "var(--text-primary)",
    fontSize: "0.9rem",
    padding: "0.5rem 1.25rem",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.2)",
  },
};
