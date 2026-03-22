import { useState, useEffect, useCallback, useRef } from "react";
import type { QueueItem } from "../../types/queue";

interface PostPlayScreenProps {
  nextItem: QueueItem;
  onPlayNext: () => void;
  onStop: () => void;
  posterUrl: (path: string) => string;
  countdownSeconds?: number;
}

/**
 * Full-screen post-play overlay shown when an episode/item ends.
 * Displays the next item info with a countdown timer that auto-plays.
 * Similar to Plex's "Playing Next" screen.
 */
export default function PostPlayScreen({
  nextItem,
  onPlayNext,
  onStop,
  posterUrl,
  countdownSeconds = 10,
}: PostPlayScreenProps) {
  const [countdown, setCountdown] = useState(countdownSeconds);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!autoPlayEnabled) return;
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoPlayEnabled]);

  // Auto-play when countdown reaches 0
  useEffect(() => {
    if (countdown === 0 && autoPlayEnabled) {
      onPlayNext();
    }
  }, [countdown, autoPlayEnabled, onPlayNext]);

  const handleToggleAutoPlay = useCallback(() => {
    setAutoPlayEnabled((prev) => {
      if (prev && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return !prev;
    });
  }, []);

  // Keyboard: Enter to play now, Escape to stop
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onPlayNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onStop();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onPlayNext, onStop]);

  const progress = ((countdownSeconds - countdown) / countdownSeconds) * 100;

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {/* Next item info */}
        <div style={styles.headerLabel}>PLAYING NEXT</div>

        <div style={styles.mainRow}>
          {/* Thumbnail with countdown ring */}
          <div style={styles.thumbContainer}>
            <img
              src={posterUrl(nextItem.thumb)}
              alt=""
              style={styles.thumb}
            />
            {autoPlayEnabled && (
              <div style={styles.countdownOverlay}>
                <svg
                  width={48}
                  height={48}
                  viewBox="0 0 48 48"
                  style={styles.countdownRing}
                >
                  <circle
                    cx={24}
                    cy={24}
                    r={20}
                    fill="none"
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth={3}
                  />
                  <circle
                    cx={24}
                    cy={24}
                    r={20}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={3}
                    strokeDasharray={`${2 * Math.PI * 20}`}
                    strokeDashoffset={`${2 * Math.PI * 20 * (1 - progress / 100)}`}
                    strokeLinecap="round"
                    transform="rotate(-90 24 24)"
                    style={{ transition: "stroke-dashoffset 1s linear" }}
                  />
                </svg>
                <span style={styles.countdownNumber}>{countdown}</span>
              </div>
            )}
          </div>

          {/* Item details */}
          <div style={styles.details}>
            <h2 style={styles.title}>{nextItem.title}</h2>
            <div style={styles.subtitle}>{nextItem.subtitle}</div>
            <div style={styles.meta}>
              {Math.round(nextItem.duration / 60000)}min
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={styles.actions}>
          <label style={styles.autoPlayToggle}>
            <input
              type="checkbox"
              checked={autoPlayEnabled}
              onChange={handleToggleAutoPlay}
              style={{ accentColor: "var(--accent)" }}
            />
            AUTO PLAY ON
          </label>
          <div style={styles.buttonRow}>
            <button onClick={onPlayNext} style={styles.playNowButton}>
              Play Now
            </button>
            <button onClick={onStop} style={styles.stopButton}>
              Stop
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    inset: 0,
    background: "rgba(0, 0, 0, 0.92)",
    zIndex: 30,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    padding: "3rem",
    animation: "fadeIn 0.3s ease-out",
  },
  content: {
    maxWidth: "700px",
  },
  headerLabel: {
    fontSize: "0.8rem",
    fontWeight: 700,
    color: "var(--text-secondary)",
    letterSpacing: "0.1em",
    marginBottom: "1.25rem",
  },
  mainRow: {
    display: "flex",
    gap: "1.5rem",
    alignItems: "flex-start",
  },
  thumbContainer: {
    position: "relative",
    flexShrink: 0,
  },
  thumb: {
    width: "160px",
    height: "110px",
    borderRadius: "8px",
    objectFit: "cover",
  },
  countdownOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.4)",
    borderRadius: "8px",
  },
  countdownRing: {
    position: "absolute",
  },
  countdownNumber: {
    fontSize: "1.3rem",
    fontWeight: 700,
    color: "#fff",
  },
  details: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
  },
  subtitle: {
    fontSize: "1rem",
    color: "var(--text-secondary)",
  },
  meta: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    marginTop: "0.25rem",
  },
  actions: {
    marginTop: "1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  autoPlayToggle: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "var(--accent)",
    letterSpacing: "0.05em",
    cursor: "pointer",
  },
  buttonRow: {
    display: "flex",
    gap: "0.75rem",
  },
  playNowButton: {
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.95rem",
    fontWeight: 600,
    padding: "0.6rem 1.5rem",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
  },
  stopButton: {
    background: "rgba(255,255,255,0.1)",
    color: "var(--text-primary)",
    fontSize: "0.95rem",
    fontWeight: 500,
    padding: "0.6rem 1.5rem",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.15)",
    cursor: "pointer",
  },
};
