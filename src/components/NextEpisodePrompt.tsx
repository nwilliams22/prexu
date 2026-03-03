import { useEffect, useState } from "react";

interface NextEpisodePromptProps {
  nextEpisodeTitle: string;
  participantCount: number;
  onContinue: () => void;
  onEndSession: () => void;
}

const AUTO_DISMISS_SECONDS = 30;

function NextEpisodePrompt({
  nextEpisodeTitle,
  participantCount,
  onContinue,
  onEndSession,
}: NextEpisodePromptProps) {
  const [countdown, setCountdown] = useState(AUTO_DISMISS_SECONDS);

  // Countdown timer — ends session when it reaches 0
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          onEndSession();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onEndSession]);

  return (
    <div style={styles.overlay}>
      <div role="alertdialog" aria-label="Next episode" style={styles.card}>
        <p style={styles.prompt}>
          Continue watching with{" "}
          <span style={styles.highlight}>
            {participantCount} friend{participantCount !== 1 ? "s" : ""}
          </span>
          ?
        </p>
        <p style={styles.nextTitle}>
          Next: <strong>{nextEpisodeTitle}</strong>
        </p>

        <div style={styles.actions}>
          <button onClick={onContinue} style={styles.continueButton}>
            Continue Together
          </button>
          <button onClick={onEndSession} style={styles.endButton}>
            End Session ({countdown}s)
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "absolute",
    bottom: "80px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 30,
  },
  card: {
    background: "rgba(0, 0, 0, 0.9)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    padding: "1.25rem 1.5rem",
    textAlign: "center",
    minWidth: "320px",
    animation: "modalSlideUp 0.25s ease-out",
  },
  prompt: {
    fontSize: "0.95rem",
    color: "var(--text-primary)",
    margin: "0 0 0.5rem",
  },
  highlight: {
    color: "var(--accent)",
    fontWeight: 600,
  },
  nextTitle: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    margin: "0 0 1rem",
  },
  actions: {
    display: "flex",
    gap: "0.75rem",
    justifyContent: "center",
  },
  continueButton: {
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "8px",
    padding: "0.5rem 1.25rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  endButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "0.5rem 1.25rem",
    fontSize: "0.9rem",
    cursor: "pointer",
  },
};

export default NextEpisodePrompt;
