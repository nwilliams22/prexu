import { useEffect, useRef } from "react";
import { useToast } from "../hooks/useToast";
import { useAnnounce } from "../hooks/useAnnounce";
import type { Toast, ToastVariant } from "../types/toast";

// ── Icons ──

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function getIcon(variant: ToastVariant) {
  switch (variant) {
    case "success": return <CheckIcon />;
    case "error": return <ErrorIcon />;
    case "info": return <InfoIcon />;
  }
}

function getVariantColor(variant: ToastVariant): string {
  switch (variant) {
    case "success": return "var(--success)";
    case "error": return "var(--error)";
    case "info": return "var(--accent)";
  }
}

// ── Styles ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    bottom: "1.5rem",
    right: "1.5rem",
    zIndex: 1500,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    pointerEvents: "none",
    maxWidth: 380,
  },
  toast: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    cursor: "pointer",
    pointerEvents: "auto",
    animation: "toastSlideIn 0.25s ease-out",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
    minWidth: 260,
  },
  message: {
    flex: 1,
    color: "var(--text-primary)",
    fontSize: "0.875rem",
    lineHeight: 1.4,
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "var(--text-secondary)",
    cursor: "pointer",
    padding: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.6,
    transition: "opacity 0.15s",
    flexShrink: 0,
  },
};

// ── Component ──

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const color = getVariantColor(toast.variant);

  return (
    <div
      role="alert"
      style={{
        ...styles.toast,
        borderLeft: `3px solid ${color}`,
      }}
      onClick={() => onDismiss(toast.id)}
    >
      <span style={{ color, display: "flex", flexShrink: 0 }}>{getIcon(toast.variant)}</span>
      <span style={styles.message}>{toast.message}</span>
      <button
        style={styles.closeBtn}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
        aria-label="Dismiss notification"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, dismiss } = useToast();
  const announce = useAnnounce();
  const prevCountRef = useRef(toasts.length);

  // Announce new toasts for screen readers
  useEffect(() => {
    if (toasts.length > prevCountRef.current) {
      const latest = toasts[toasts.length - 1];
      announce(
        latest.message,
        latest.variant === "error" ? "assertive" : "polite",
      );
    }
    prevCountRef.current = toasts.length;
  }, [toasts, announce]);

  if (toasts.length === 0) return null;

  return (
    <div style={styles.container}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
