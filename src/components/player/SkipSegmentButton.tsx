import { useEffect, useCallback } from "react";
import type { ActiveSegment } from "../../hooks/player/useSkipSegments";

interface SkipSegmentButtonProps {
  segment: ActiveSegment;
  onSkip: () => void;
  onDismiss: () => void;
  hasNextEpisode?: boolean;
  onNextEpisode?: () => void;
}

export default function SkipSegmentButton({
  segment,
  onSkip,
  onDismiss,
  hasNextEpisode,
  onNextEpisode,
}: SkipSegmentButtonProps) {
  const isCredits = segment.type === "credits";
  const showNextEpisode = isCredits && hasNextEpisode && onNextEpisode;

  const handleClick = useCallback(() => {
    if (showNextEpisode) {
      onNextEpisode!();
    } else {
      onSkip();
    }
  }, [showNextEpisode, onNextEpisode, onSkip]);

  // Keyboard shortcut: S to skip
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        handleClick();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClick]);

  const label = showNextEpisode
    ? "Next Episode"
    : isCredits
      ? "Skip Credits"
      : "Skip Intro";

  return (
    <div style={styles.container}>
      <button
        onClick={handleClick}
        style={styles.button}
        aria-label={label}
      >
        {label}
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="5 4 15 12 5 20" />
          <line x1={19} y1={5} x2={19} y2={19} />
        </svg>
      </button>
      <button
        onClick={onDismiss}
        style={styles.dismissButton}
        aria-label="Dismiss"
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <line x1={18} y1={6} x2={6} y2={18} />
          <line x1={6} y1={6} x2={18} y2={18} />
        </svg>
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    bottom: "100px",
    right: "2rem",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    zIndex: 20,
    animation: "skipSlideIn 0.3s ease-out",
  },
  button: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    background: "rgba(255, 255, 255, 0.95)",
    color: "#000",
    fontSize: "0.95rem",
    fontWeight: 600,
    padding: "0.6rem 1.25rem",
    borderRadius: "6px",
    border: "none",
    cursor: "pointer",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
    transition: "background 0.15s ease, transform 0.15s ease",
  },
  dismissButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "rgba(0, 0, 0, 0.6)",
    color: "rgba(255, 255, 255, 0.8)",
    border: "none",
    cursor: "pointer",
    backdropFilter: "blur(4px)",
    padding: 0,
  },
};
