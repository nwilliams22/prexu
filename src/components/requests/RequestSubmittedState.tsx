/**
 * Success state shown after a content request has been submitted.
 */

import { useRef } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useBreakpoint, isMobile } from "../../hooks/useBreakpoint";

interface RequestSubmittedStateProps {
  onClose: () => void;
  targetServerName?: string;
}

function RequestSubmittedState({ onClose, targetServerName }: RequestSubmittedStateProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);
  const bp = useBreakpoint();
  const mobile = isMobile(bp);

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div
        ref={panelRef}
        style={{ ...styles.panel, ...(mobile ? styles.panelMobile : {}) }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Request submitted"
      >
        <h2 style={styles.title}>Request Submitted!</h2>
        <p style={styles.description}>
          Your request has been sent
          {targetServerName ? ` to the admin of ${targetServerName}` : ""}.
          You can track its status on the Requests page.
        </p>
        <button onClick={onClose} style={styles.submitButton}>
          Done
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
  },
  panel: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    padding: "1.5rem",
    width: "100%",
    maxWidth: "480px",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
  },
  panelMobile: {
    maxWidth: "100%",
    maxHeight: "90vh",
    borderRadius: "8px",
  },
  title: {
    fontSize: "1.1rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: 0,
  },
  description: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    margin: 0,
  },
  submitButton: {
    padding: "0.5rem 1rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    borderRadius: "6px",
    background: "var(--accent)",
    color: "#000",
    border: "none",
    cursor: "pointer",
  },
};

export default RequestSubmittedState;
