/**
 * Skip Intro / Skip Credits / Next Episode pill cluster for the mini player.
 *
 * Rendered above the scrub bar when an active segment is present. Uses
 * resolveSkipPillDecision (shared with SkipSegmentButton) so the label and
 * two-button split logic lives in exactly one place.
 */

import type React from "react";
import type { ActiveSegment } from "../../hooks/player/useSkipSegments";
import { resolveSkipPillDecision } from "./skipSegmentDecision";

interface MiniSkipPillsProps {
  /** Active intro or credits segment. When null, nothing is rendered. */
  activeSegment: ActiveSegment | null | undefined;
  /** Called when the user clicks the primary skip button. Required for the
   *  pill to appear (defensive — callers that don't wire a handler suppress
   *  the pill entirely). */
  onSkipSegment?: () => void;
  /** True when there is a next item in the queue. Controls whether the
   *  secondary "Next Episode" pill appears during credits. */
  hasNextItem?: boolean;
  /** Called when the user clicks the secondary "Next Episode" pill. */
  onNextEpisode?: () => void;
  /** Whether the pill cluster is visible (opacity + pointer-events). Matches
   *  the mini chrome's auto-hide state. */
  visible: boolean;
  /** Wraps each button click: stops propagation, calls onActivity, then the
   *  handler. Passed in from MiniChrome so this component doesn't need to
   *  accept a separate onActivity prop and duplicate the wrap logic. */
  handleButtonClick: (handler: () => void) => (e: React.MouseEvent) => void;
}

const styles = {
  // Pill stack sits above the scrub bar so the controls cluster stays coherent.
  skipPillWrap: {
    position: "absolute" as const,
    bottom: 104,
    left: 12,
    transition: "opacity 0.2s ease",
    zIndex: 2,
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 6,
    alignItems: "flex-start" as const,
  },
  skipPill: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 6,
    background: "rgba(255, 255, 255, 0.92)",
    color: "#000",
    border: "none",
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.35)",
  },
  skipPillSecondary: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 6,
    background: "rgba(0, 0, 0, 0.70)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.25)",
    borderRadius: 999,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.35)",
  },
};

export default function MiniSkipPills({
  activeSegment,
  onSkipSegment,
  hasNextItem,
  onNextEpisode,
  visible,
  handleButtonClick,
}: MiniSkipPillsProps) {
  // Suppress entirely when there is no active segment or no skip handler wired
  // (defensive — callers that haven't wired a handler must not show a dead pill).
  if (!activeSegment || !onSkipSegment) return null;

  const { primaryLabel, showNextEpisode } = resolveSkipPillDecision(
    activeSegment.type,
    Boolean(hasNextItem),
    Boolean(onNextEpisode),
  );

  return (
    <div
      style={{
        ...styles.skipPillWrap,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
      data-testid="mini-chrome-skip-pill-wrap"
      data-mini-no-drag="true"
    >
      <button
        type="button"
        onClick={handleButtonClick(onSkipSegment)}
        style={styles.skipPill}
        aria-label={primaryLabel}
        data-testid="mini-chrome-skip-pill"
      >
        {primaryLabel}
      </button>
      {showNextEpisode && onNextEpisode && (
        <button
          type="button"
          onClick={handleButtonClick(onNextEpisode)}
          style={styles.skipPillSecondary}
          aria-label="Next Episode"
          data-testid="mini-chrome-skip-pill-next"
        >
          Next Episode
        </button>
      )}
    </div>
  );
}
