import { useNavigate, useLocation } from "react-router-dom";
import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Back / Forward navigation buttons displayed in the header,
 * aligned above the main content area (to the right of the sidebar).
 *
 * Uses useState for currentIndex so the UI re-renders when navigation
 * state changes (refs alone wouldn't trigger a re-render).
 */
function NavButtons() {
  const navigate = useNavigate();
  const location = useLocation();

  const historyStack = useRef<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const isNavAction = useRef(false);

  useEffect(() => {
    const path = location.pathname + location.search;

    if (isNavAction.current) {
      isNavAction.current = false;
      return;
    }

    // Normal navigation — push and truncate forward entries
    setCurrentIndex((prev) => {
      const newIndex = prev + 1;
      historyStack.current = [
        ...historyStack.current.slice(0, newIndex),
        path,
      ];
      return newIndex;
    });
  }, [location]);

  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex < historyStack.current.length - 1;

  const goBack = useCallback(() => {
    if (currentIndex <= 0) return;
    isNavAction.current = true;
    setCurrentIndex((prev) => prev - 1);
    navigate(-1);
  }, [currentIndex, navigate]);

  const goForward = useCallback(() => {
    if (currentIndex >= historyStack.current.length - 1) return;
    isNavAction.current = true;
    setCurrentIndex((prev) => prev + 1);
    navigate(1);
  }, [currentIndex, navigate]);

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
