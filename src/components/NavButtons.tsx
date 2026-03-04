import { useNavigate, useLocation } from "react-router-dom";
import { useRef, useEffect, useCallback } from "react";

/**
 * Back / Forward navigation buttons displayed in the header,
 * aligned above the main content area (to the right of the sidebar).
 */
function NavButtons() {
  const navigate = useNavigate();
  const location = useLocation();

  // Track history stack for back/forward awareness
  const historyStack = useRef<string[]>([]);
  const currentIndex = useRef(-1);
  const isNavAction = useRef(false);

  useEffect(() => {
    const path = location.pathname + location.search;

    if (isNavAction.current) {
      isNavAction.current = false;
      return;
    }

    // Normal navigation — push and truncate forward entries
    currentIndex.current += 1;
    historyStack.current = [
      ...historyStack.current.slice(0, currentIndex.current),
      path,
    ];
  }, [location]);

  const canGoBack = currentIndex.current > 0;
  const canGoForward =
    currentIndex.current < historyStack.current.length - 1;

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    isNavAction.current = true;
    currentIndex.current -= 1;
    navigate(-1);
  }, [canGoBack, navigate]);

  const goForward = useCallback(() => {
    if (!canGoForward) return;
    isNavAction.current = true;
    currentIndex.current += 1;
    navigate(1);
  }, [canGoForward, navigate]);

  return (
    <div style={styles.container}>
      <button
        onClick={goBack}
        disabled={!canGoBack}
        style={{
          ...styles.button,
          ...(canGoBack ? {} : styles.disabled),
        }}
        aria-label="Go back"
      >
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button
        onClick={goForward}
        disabled={!canGoForward}
        style={{
          ...styles.button,
          ...(canGoForward ? {} : styles.disabled),
        }}
        aria-label="Go forward"
      >
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: "0.125rem",
    flexShrink: 0,
  },
  button: {
    background: "transparent",
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.375rem",
    flexShrink: 0,
    cursor: "pointer",
    borderRadius: "6px",
    border: "none",
  },
  disabled: {
    opacity: 0.3,
    cursor: "default",
  },
};

export default NavButtons;
