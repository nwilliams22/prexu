/**
 * Small popover offering "Resume from XX:XX" or "Play from Beginning".
 * Shown when a partially watched item's play button is clicked.
 */

import { useEffect, useRef } from "react";
import { formatTimeMs } from "../utils/time-format";

interface ResumePopoverProps {
  /** View offset in milliseconds */
  viewOffset: number;
  /** Screen position to anchor the popover */
  anchorPosition: { x: number; y: number };
  /** Called when "Resume" is chosen */
  onResume: () => void;
  /** Called when "Play from Beginning" is chosen */
  onPlayFromBeginning: () => void;
  /** Close the popover without action */
  onClose: () => void;
}

function ResumePopover({
  viewOffset,
  anchorPosition,
  onResume,
  onPlayFromBeginning,
  onClose,
}: ResumePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Adjust position to stay within viewport
  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      el.style.left = `${anchorPosition.x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${anchorPosition.y - rect.height}px`;
    }
  }, [anchorPosition]);

  return (
    <div
      ref={popoverRef}
      style={{
        ...styles.popover,
        left: anchorPosition.x,
        top: anchorPosition.y,
      }}
    >
      <button
        style={styles.option}
        onClick={() => {
          onResume();
          onClose();
        }}
      >
        <svg
          aria-hidden="true"
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="currentColor"
          style={styles.icon}
        >
          <polygon points="6,3 21,12 6,21" />
        </svg>
        Resume from {formatTimeMs(viewOffset)}
      </button>
      <button
        style={styles.option}
        onClick={() => {
          onPlayFromBeginning();
          onClose();
        }}
      >
        <svg
          aria-hidden="true"
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={styles.icon}
        >
          <polygon points="5,3 19,12 5,21" fill="currentColor" />
          <line x1={3} y1={3} x2={3} y2={21} />
        </svg>
        Play from Beginning
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  popover: {
    position: "fixed",
    zIndex: 1200,
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "4px 0",
    minWidth: "220px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
    animation: "popIn 0.12s ease-out",
    transformOrigin: "top left",
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%",
    textAlign: "left",
    padding: "10px 14px",
    fontSize: "0.85rem",
    color: "var(--text-primary)",
    background: "transparent",
    border: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  icon: {
    flexShrink: 0,
    opacity: 0.7,
  },
};

export default ResumePopover;
