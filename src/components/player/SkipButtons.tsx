/**
 * Transport skip buttons — previous/next episode, chapter skip,
 * and hold-to-accelerate 10s skip with play/pause in the center.
 */

import { useRef, useCallback, useState } from "react";
import type { UsePlayerResult } from "../../hooks/usePlayer";
import type { PlexChapter } from "../../types/library";
import { useHoldToSkip } from "../../hooks/useHoldToSkip";

const SKIP_SECONDS = 10;

interface SkipButtonsProps {
  player: UsePlayerResult;
  chapters?: PlexChapter[];
  seekFn: (time: number) => void;
  onActivity?: () => void;
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
  mobile: boolean;
  iconSmall: number;
  iconLarge: number;
}

function SkipButtons({
  player,
  chapters,
  seekFn,
  onActivity,
  onNextEpisode,
  onPrevEpisode,
  mobile,
  iconSmall,
  iconLarge,
}: SkipButtonsProps) {
  const [skipIndicator, setSkipIndicator] = useState<string | null>(null);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for latest values so hold-to-skip callbacks always read current state
  const seekFnRef = useRef(seekFn);
  seekFnRef.current = seekFn;
  const currentTimeRef = useRef(player.currentTime);
  currentTimeRef.current = player.currentTime;
  const durationRef = useRef(player.duration);
  durationRef.current = player.duration;

  const showSkipIndicator = useCallback(
    (label: string) => {
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
      setSkipIndicator(label);
      skipTimerRef.current = setTimeout(() => setSkipIndicator(null), 600);
      onActivity?.();
    },
    [onActivity],
  );

  const skipBackward = useHoldToSkip({
    direction: "backward",
    onSkip: useCallback((seconds: number) => {
      seekFnRef.current(Math.max(0, currentTimeRef.current - seconds));
    }, []),
    onSkipLabel: showSkipIndicator,
  });

  const skipForward = useHoldToSkip({
    direction: "forward",
    onSkip: useCallback((seconds: number) => {
      seekFnRef.current(Math.min(durationRef.current, currentTimeRef.current + seconds));
    }, []),
    onSkipLabel: showSkipIndicator,
  });

  const handleChapterSkip = useCallback(
    (direction: "next" | "prev") => {
      if (chapters && chapters.length > 0) {
        const currentMs = player.currentTime * 1000;
        if (direction === "next") {
          const next = chapters.find((c) => c.startTimeOffset > currentMs + 1000);
          if (next) {
            seekFn(next.startTimeOffset / 1000);
            showSkipIndicator(next.tag);
            return;
          }
        } else {
          const sorted = [...chapters].sort((a, b) => b.startTimeOffset - a.startTimeOffset);
          const prev = sorted.find((c) => c.startTimeOffset < currentMs - 2000);
          if (prev) {
            seekFn(prev.startTimeOffset / 1000);
            showSkipIndicator(prev.tag);
            return;
          }
        }
      }
      const delta = direction === "next" ? 30 : -30;
      const target = Math.max(0, Math.min(player.duration, player.currentTime + delta));
      seekFn(target);
      showSkipIndicator(direction === "next" ? "+30" : "-30");
    },
    [chapters, player.currentTime, player.duration, seekFn, showSkipIndicator],
  );

  const btnStyle = {
    ...styles.controlButton,
    ...(mobile ? { padding: "0.5rem" } : {}),
  };

  return (
    <>
      {/* Skip indicator overlay */}
      {skipIndicator && (
        <div style={styles.skipOverlay} key={skipIndicator + Date.now()}>
          <span
            style={
              skipIndicator.length > 5
                ? styles.skipOverlayChapter
                : styles.skipOverlayText
            }
          >
            {skipIndicator}
          </span>
        </div>
      )}

      {/* Previous episode */}
      {onPrevEpisode && (
        <button onClick={onPrevEpisode} style={btnStyle} aria-label="Previous episode">
          <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="currentColor">
            <rect x={4} y={5} width={3} height={14} rx={0.5} />
            <polygon points="18,5 9,12 18,19" />
          </svg>
        </button>
      )}

      {/* Chapter back / 30s */}
      <button
        onClick={() => handleChapterSkip("prev")}
        style={btnStyle}
        aria-label={chapters && chapters.length > 0 ? "Previous chapter" : "Rewind 30 seconds"}
      >
        <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="11 17 6 12 11 7" />
          <polyline points="18 17 13 12 18 7" />
        </svg>
      </button>

      {/* 10s back — hold to accelerate */}
      <button
        onPointerDown={skipBackward.onPointerDown}
        onPointerUp={skipBackward.onPointerUp}
        onPointerLeave={skipBackward.onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        style={btnStyle}
        aria-label={`Rewind ${SKIP_SECONDS} seconds`}
      >
        <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <path d="M4 12a8 8 0 1 1 2.3 5.7" />
          <polyline points="4 8 4 12 8 12" />
          <text x="12" y="14.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">10</text>
        </svg>
      </button>

      {/* Play / Pause */}
      <button onClick={player.togglePlay} style={btnStyle} aria-label={player.isPlaying ? "Pause" : "Play"}>
        {player.isPlaying ? (
          <svg width={iconLarge} height={iconLarge} viewBox="0 0 24 24" fill="currentColor">
            <rect x={6} y={4} width={4} height={16} rx={1} />
            <rect x={14} y={4} width={4} height={16} rx={1} />
          </svg>
        ) : (
          <svg width={iconLarge} height={iconLarge} viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,4 20,12 6,20" />
          </svg>
        )}
      </button>

      {/* 10s forward — hold to accelerate */}
      <button
        onPointerDown={skipForward.onPointerDown}
        onPointerUp={skipForward.onPointerUp}
        onPointerLeave={skipForward.onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        style={btnStyle}
        aria-label={`Forward ${SKIP_SECONDS} seconds`}
      >
        <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <path d="M20 12a8 8 0 1 0-2.3 5.7" />
          <polyline points="20 8 20 12 16 12" />
          <text x="12" y="14.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">10</text>
        </svg>
      </button>

      {/* Chapter forward / 30s */}
      <button
        onClick={() => handleChapterSkip("next")}
        style={btnStyle}
        aria-label={chapters && chapters.length > 0 ? "Next chapter" : "Forward 30 seconds"}
      >
        <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="13 17 18 12 13 7" />
          <polyline points="6 17 11 12 6 7" />
        </svg>
      </button>

      {/* Next episode */}
      {onNextEpisode && (
        <button onClick={onNextEpisode} style={btnStyle} aria-label="Next episode">
          <svg width={iconSmall} height={iconSmall} viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,5 15,12 6,19" />
            <rect x={17} y={5} width={3} height={14} rx={0.5} />
          </svg>
        </button>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  controlButton: {
    background: "transparent",
    color: "var(--text-primary)",
    padding: "0.35rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "4px",
  },
  skipOverlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 20,
    pointerEvents: "none",
  },
  skipOverlayText: {
    fontSize: "3rem",
    fontWeight: 700,
    color: "rgba(255,255,255,0.85)",
    textShadow: "0 2px 12px rgba(0,0,0,0.6)",
    fontVariantNumeric: "tabular-nums",
  },
  skipOverlayChapter: {
    fontSize: "1.5rem",
    fontWeight: 600,
    color: "rgba(255,255,255,0.9)",
    textShadow: "0 2px 12px rgba(0,0,0,0.6)",
    background: "rgba(0,0,0,0.5)",
    padding: "0.35rem 1rem",
    borderRadius: "8px",
    whiteSpace: "nowrap" as const,
  },
};

export default SkipButtons;
