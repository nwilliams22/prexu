import { useState, useEffect } from "react";

/**
 * Branded splash screen shown during app initialization.
 * Displays Prexu logo with a subtle pulse animation, then fades out
 * when `ready` becomes true.
 */
function SplashScreen({ ready }: { ready: boolean }) {
  const [fadeOut, setFadeOut] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!ready) return;
    // Start fade-out, then unmount
    setFadeOut(true);
    const timer = setTimeout(() => setHidden(true), 400);
    return () => clearTimeout(timer);
  }, [ready]);

  if (hidden) return null;

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
        <div style={styles.spinnerRow}>
          <div className="loading-spinner" />
        </div>
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
    marginTop: "0.5rem",
  },
};

export default SplashScreen;
