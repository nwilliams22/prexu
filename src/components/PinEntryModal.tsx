import { useState, useEffect, useRef } from "react";

interface PinEntryModalProps {
  userName: string;
  userThumb: string;
  error: string | null;
  isLoading: boolean;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}

function PinEntryModal({
  userName,
  userThumb,
  error,
  isLoading,
  onSubmit,
  onCancel,
}: PinEntryModalProps) {
  const [pin, setPin] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length > 0 && !isLoading) {
      onSubmit(pin);
    }
  };

  return (
    <div style={styles.backdrop} onClick={onCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {userThumb ? (
          <img src={userThumb} alt="" style={styles.avatar} />
        ) : (
          <div style={styles.avatarFallback}>
            {userName.charAt(0).toUpperCase()}
          </div>
        )}
        <p style={styles.userName}>{userName}</p>
        <p style={styles.hint}>Enter PIN to switch user</p>

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="PIN"
            style={styles.pinInput}
            disabled={isLoading}
          />

          {error && <p style={styles.error}>{error}</p>}

          <div style={styles.actions}>
            <button
              type="button"
              onClick={onCancel}
              style={styles.cancelButton}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                ...styles.submitButton,
                opacity: pin.length === 0 || isLoading ? 0.5 : 1,
              }}
              disabled={pin.length === 0 || isLoading}
            >
              {isLoading ? "Switching..." : "Switch"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1200,
  },
  modal: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    padding: "2rem",
    width: "320px",
    textAlign: "center",
    animation: "popIn 0.15s ease-out",
  },
  avatar: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    objectFit: "cover",
    marginBottom: "0.75rem",
  },
  avatarFallback: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    background: "var(--bg-secondary)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.25rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: "0.75rem",
  },
  userName: {
    fontSize: "1rem",
    fontWeight: 600,
    marginBottom: "0.25rem",
  },
  hint: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    marginBottom: "1rem",
  },
  pinInput: {
    width: "100%",
    padding: "0.6rem 0.75rem",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: "1.25rem",
    textAlign: "center",
    letterSpacing: "0.5rem",
    outline: "none",
    boxSizing: "border-box",
  },
  error: {
    color: "var(--error)",
    fontSize: "0.8rem",
    marginTop: "0.5rem",
  },
  actions: {
    display: "flex",
    gap: "0.5rem",
    marginTop: "1.25rem",
  },
  cancelButton: {
    flex: 1,
    padding: "0.5rem 1.25rem",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  submitButton: {
    flex: 1,
    padding: "0.5rem 1.25rem",
    borderRadius: "8px",
    border: "none",
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

export default PinEntryModal;
