import { useEffect, useCallback } from "react";
import type { ActiveSegment } from "../../hooks/player/useSkipSegments";
import { resolveSkipPillDecision } from "./skipSegmentDecision";

interface SkipSegmentButtonProps {
  segment: ActiveSegment;
  onSkip: () => void;
  onDismiss: () => void;
  hasNextEpisode?: boolean;
  onNextEpisode?: () => void;
}

/**
 * Skip-segment overlay shown during intro/credits markers.
 *
 * Layout:
 *   - Intro: single "Skip Intro" button.
 *   - Credits without next episode: single "Skip Credits" button.
 *   - Credits with next episode: TWO stacked buttons — "Skip Credits"
 *     (primary, top) and "Next Episode" (secondary, below). Splitting them
 *     lets the user skip past credits to watch post-credits scenes (Marvel
 *     stingers, anime omake, etc.) instead of being forced into the next
 *     episode. The 'S' keyboard shortcut always triggers the primary skip;
 *     Shift+N already advances to the next episode globally
 *     (usePlayerKeyboardShortcuts), so no new key is added here.
 */
export default function SkipSegmentButton({
  segment,
  onSkip,
  onDismiss,
  hasNextEpisode,
  onNextEpisode,
}: SkipSegmentButtonProps) {
  const { primaryLabel, showNextEpisode } = resolveSkipPillDecision(
    segment.type,
    Boolean(hasNextEpisode),
    Boolean(onNextEpisode),
  );

  // Keyboard: S always triggers the primary skip (intro or credits).
  // Guard: do not intercept while the user is typing in an input-like element.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        // isContentEditable reflects the computed state; the contentEditable
        // attribute check covers environments (e.g. jsdom) that don't implement
        // the computed property.
        target?.isContentEditable ||
        target?.contentEditable === "true"
      ) {
        return;
      }
      if (e.key === "s" || e.key === "S") {
        if (e.shiftKey) return; // Shift+S reserved for future bindings
        e.preventDefault();
        onSkip();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSkip]);

  const handleNextEpisodeClick = useCallback(() => {
    if (onNextEpisode) onNextEpisode();
  }, [onNextEpisode]);

  return (
    <div style={styles.container}>
      <div style={styles.buttonStack}>
        <button
          onClick={onSkip}
          style={styles.button}
          aria-label={primaryLabel}
        >
          {primaryLabel}
          <ChevronIcon />
        </button>
        {showNextEpisode && (
          <button
            onClick={handleNextEpisodeClick}
            style={styles.secondaryButton}
            aria-label="Next Episode"
          >
            Next Episode
            <ChevronIcon />
          </button>
        )}
      </div>
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

function ChevronIcon() {
  return (
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
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    bottom: "100px",
    right: "2rem",
    display: "flex",
    alignItems: "flex-end",
    gap: "0.5rem",
    zIndex: 20,
    animation: "skipSlideIn 0.3s ease-out",
  },
  buttonStack: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    alignItems: "stretch",
  },
  button: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
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
  secondaryButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    background: "rgba(0, 0, 0, 0.7)",
    color: "#fff",
    fontSize: "0.9rem",
    fontWeight: 500,
    padding: "0.55rem 1.15rem",
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.2)",
    cursor: "pointer",
    backdropFilter: "blur(4px)",
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
