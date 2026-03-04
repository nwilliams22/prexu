import { useNavigate, useLocation } from "react-router-dom";
import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Back / Forward navigation buttons displayed in the header,
 * aligned above the main content area (to the right of the sidebar).
 *
 * History state lives at module scope so it persists when NavButtons
 * unmounts (e.g. navigating to the Player route which is outside AppLayout)
 * and remounts when returning.
 */

// ── Module-level history state (survives component mount/unmount) ──
let _historyStack: string[] = [];
let _currentIndex = -1;
let _isNavAction = false;

function NavButtons() {
  const navigate = useNavigate();
  const location = useLocation();

  // Force re-renders by tracking index in state, synced from module state
  const [currentIndex, setCurrentIndex] = useState(_currentIndex);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const path = location.pathname + location.search;

    if (_isNavAction) {
      _isNavAction = false;
      return;
    }

    // Don't double-push if the path is already the current entry
    // (happens when remounting after Player route)
    if (_currentIndex >= 0 && _historyStack[_currentIndex] === path) {
      // Just sync the component state
      setCurrentIndex(_currentIndex);
      return;
    }

    // Normal navigation — push and truncate forward entries
    _currentIndex += 1;
    _historyStack = [
      ..._historyStack.slice(0, _currentIndex),
      path,
    ];
    setCurrentIndex(_currentIndex);
  }, [location]);

  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex < _historyStack.length - 1;

  const goBack = useCallback(() => {
    if (_currentIndex <= 0) return;
    _isNavAction = true;
    _currentIndex -= 1;
    setCurrentIndex(_currentIndex);
    navigate(-1);
  }, [navigate]);

  const goForward = useCallback(() => {
    if (_currentIndex >= _historyStack.length - 1) return;
    _isNavAction = true;
    _currentIndex += 1;
    setCurrentIndex(_currentIndex);
    navigate(1);
  }, [navigate]);

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
