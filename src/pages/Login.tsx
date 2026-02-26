import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { createPin, getAuthUrl, pollForAuth } from "../services/plex-auth";
import { useAuth } from "../hooks/useAuth";

type LoginState = "idle" | "waiting" | "success" | "error";

function Login() {
  const { login } = useAuth();
  const [state, setState] = useState<LoginState>("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setState("waiting");
    setError(null);

    try {
      // Step 1: Create a PIN
      const pin = await createPin();

      // Step 2: Open browser to Plex auth page
      const authUrl = await getAuthUrl(pin.code);
      await open(authUrl);

      // Step 3: Poll until the user completes auth
      const authToken = await pollForAuth(pin.id);

      // Step 4: Save auth and update state
      await login(authToken);
      setState("success");
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error ? err.message : "Authentication failed. Please try again."
      );
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
              A browser window should have opened. Complete the sign-in there,
              then come back here.
            </p>
            <button
              onClick={() => setState("idle")}
              style={styles.cancelButton}
            >
              Cancel
            </button>
          </div>
        )}

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
    fontSize: "1rem",
    fontWeight: 600,
    padding: "0.75rem 2rem",
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
    padding: "0.5rem 1.5rem",
    borderRadius: "6px",
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
