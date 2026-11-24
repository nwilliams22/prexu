import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { createPin, getAuthUrl, pollForAuth } from "../services/plex-auth";
import { useAuth } from "../hooks/useAuth";

type LoginState = "idle" | "waiting" | "success" | "error";

function Login() {
  const { login } = useAuth();
  const [state, setState] = useState<LoginState>("idle");
  const [error, setError] = useState<string | null>(null);

  const attemptRef = useRef<AbortController | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [browserFailed, setBrowserFailed] = useState(false);

  useEffect(() => () => attemptRef.current?.abort(), []);

  const handleCancel = () => {
    attemptRef.current?.abort();
    setAuthUrl(null);
    setCopyStatus(null);
    setState("idle");
  };

  const handleSignIn = async () => {
    attemptRef.current?.abort();
    const attempt = new AbortController();
    attemptRef.current = attempt;
    const { signal } = attempt;
    setState("waiting");
    setError(null);
    setAuthUrl(null);
    setCopyStatus(null);
    setBrowserFailed(false);

    try {
      const pin = await createPin(signal);
      signal.throwIfAborted();
      const url = await getAuthUrl(pin.code);
      signal.throwIfAborted();
      setAuthUrl(url);
      try {
        await open(url);
      } catch {
        // Keep polling: the user can open the copied link in another browser.
        if (!signal.aborted) setBrowserFailed(true);
      }
      signal.throwIfAborted();
      const authToken = await pollForAuth(pin.id, signal);
      signal.throwIfAborted();

      // Authentication is now accepted; remove Cancel before saving the session.
      setState("success");
      setAuthUrl(null);
      await login(authToken);
    } catch {
      if (signal.aborted) return;
      attempt.abort();
      setAuthUrl(null);
      setState("error");
      // Network and shell errors can contain the PIN URL. Never display them.
      setError("Authentication failed or timed out. Please try again.");
    }
  };

  const handleCopyLink = async () => {
    const attempt = attemptRef.current;
    if (!authUrl || !attempt || attempt.signal.aborted) return;
    try {
      await navigator.clipboard.writeText(authUrl);
      if (!attempt.signal.aborted) setCopyStatus("Sign-in link copied.");
    } catch {
      if (!attempt.signal.aborted) {
        setCopyStatus("Could not copy the link. Try again or restart sign-in.");
      }
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <h1 style={styles.title}>Prexu</h1>
          <p style={styles.subtitle}>A custom Plex client</p>
        </div>

        {state === "idle" && (
          <button onClick={handleSignIn} style={styles.signInButton}>
            Sign in with Plex
          </button>
        )}

        {state === "waiting" && (
          <div style={styles.waitingContainer}>
            <div style={styles.spinner} />
            <p style={styles.waitingText}>
              Waiting for you to sign in...
            </p>
            <p style={styles.waitingHint}>
              {browserFailed
                ? "Could not open your browser."
                : "A browser window should have opened."}{" "}
              Complete the sign-in there, then come back here. If it does not work,
              copy the sign-in link and open it in another browser.
            </p>
            {authUrl && (
              <button onClick={handleCopyLink} style={styles.cancelButton}>
                Copy sign-in link
              </button>
            )}
            {copyStatus && <p role="status" style={styles.waitingHint}>{copyStatus}</p>}
            <button
              onClick={handleCancel}
              style={styles.cancelButton}
            >
              Cancel
            </button>
          </div>
        )}

        {state === "success" && <p role="status">Completing sign-in...</p>}

        {state === "error" && (
          <div style={styles.errorContainer}>
            <p style={styles.errorText}>{error}</p>
            <button onClick={handleSignIn} style={styles.signInButton}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    padding: "2rem",
  },
  card: {
    background: "var(--bg-card)",
    borderRadius: "12px",
    padding: "3rem",
    textAlign: "center",
    maxWidth: "420px",
    width: "100%",
    border: "1px solid var(--border)",
  },
  logo: {
    marginBottom: "2rem",
  },
  title: {
    fontSize: "2.5rem",
    fontWeight: 700,
    color: "var(--accent)",
    marginBottom: "0.5rem",
  },
  subtitle: {
    fontSize: "1rem",
    color: "var(--text-secondary)",
  },
  signInButton: {
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.95rem",
    fontWeight: 600,
    padding: "0.6rem 1.5rem",
    borderRadius: "8px",
    width: "100%",
    transition: "background 0.2s",
  },
  waitingContainer: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "1rem",
  },
  spinner: {
    width: "40px",
    height: "40px",
    border: "3px solid var(--border)",
    borderTopColor: "var(--accent)",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  waitingText: {
    fontSize: "1rem",
    color: "var(--text-primary)",
  },
  waitingHint: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  },
  cancelButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    padding: "0.5rem 1.25rem",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    marginTop: "0.5rem",
  },
  errorContainer: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "1rem",
  },
  errorText: {
    color: "var(--error)",
    fontSize: "0.9rem",
  },
};

export default Login;
