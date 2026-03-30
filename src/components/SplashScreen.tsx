import { useState, useEffect, useRef } from "react";

/** Minimum time (ms) the splash screen stays visible to avoid a flash. */
const MIN_DISPLAY_MS = 2000;

interface SplashScreenProps {
  ready: boolean;
  /** Whether an update is being installed (blocks dismissal, shows progress) */
  updating?: boolean;
  /** Download progress 0–100, null if indeterminate */
  updateProgress?: number | null;
}

/**
 * Branded splash screen shown during app initialization.
 * Displays Prexu logo with a subtle pulse animation, then fades out
 * when `ready` becomes true AND the minimum display time has elapsed.
 * If an update is being installed, shows a progress bar instead of the spinner.
 */
function SplashScreen({ ready, updating, updateProgress }: SplashScreenProps) {
  const [fadeOut, setFadeOut] = useState(false);
  const [hidden, setHidden] = useState(false);
  const mountTime = useRef(Date.now());

  // Block fade-out while updating
  const canDismiss = ready && !updating;

  useEffect(() => {
    if (!canDismiss) return;

    const elapsed = Date.now() - mountTime.current;
    const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

    const delayTimer = setTimeout(() => {
      setFadeOut(true);
    }, remaining);

    const hideTimer = setTimeout(() => {
      setHidden(true);
    }, remaining + 400);

    return () => {
      clearTimeout(delayTimer);
      clearTimeout(hideTimer);
    };
  }, [canDismiss]);

  if (hidden) return null;

  const progressPct = updateProgress ?? 0;

  return (
    <div
      style={{
        ...styles.container,
        opacity: fadeOut ? 0 : 1,
        transition: "opacity 0.4s ease-out",
      }}
    >
      <div style={styles.content}>
        <div style={styles.logoWrapper}>
          <svg
            width={64}
            height={64}
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Play triangle */}
            <polygon points="5 3 19 12 5 21 5 3" fill="var(--accent)" stroke="none" />
          </svg>
        </div>
        <h1 style={styles.title}>Prexu</h1>

        {updating ? (
          <div style={styles.updateSection}>
            <span style={styles.updateLabel}>Installing update...</span>
            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${progressPct}%`,
                }}
              />
            </div>
            {updateProgress != null && (
              <span style={styles.updatePct}>{progressPct}%</span>
            )}
          </div>
        ) : (
          <div style={styles.spinnerRow}>
            <div className="loading-spinner" />
            <span style={styles.statusLabel}>Fetching server content…</span>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-primary)",
    zIndex: 9999,
  },
  content: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1.5rem",
    animation: "pageEnter 0.5s ease-out",
  },
  logoWrapper: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: "2.5rem",
    fontWeight: 700,
    color: "var(--accent)",
    margin: 0,
    letterSpacing: "-0.02em",
  },
  spinnerRow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.75rem",
    marginTop: "0.5rem",
  },
  statusLabel: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  updateSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.5rem",
    width: "240px",
    marginTop: "0.5rem",
  },
  updateLabel: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  progressTrack: {
    width: "100%",
    height: "4px",
    borderRadius: "2px",
    background: "var(--border)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: "2px",
    background: "var(--accent)",
    transition: "width 0.3s ease-out",
  },
  updatePct: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
};

export default SplashScreen;
