import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <svg
            width={48}
            height={48}
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--error)"
            strokeWidth={1.5}
            style={{ opacity: 0.8 }}
          >
            <circle cx={12} cy={12} r={10} />
            <line x1={12} y1={8} x2={12} y2={12} />
            <line x1={12} y1={16} x2={12.01} y2={16} />
          </svg>
          <h2 style={styles.title}>Something went wrong</h2>
          <p style={styles.message}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button onClick={this.handleReload} style={styles.button}>
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "4rem 2rem",
    gap: "0.75rem",
    textAlign: "center",
    minHeight: "300px",
  },
  title: {
    margin: 0,
    fontSize: "1.25rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  message: {
    margin: 0,
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    maxWidth: "400px",
    lineHeight: 1.5,
  },
  button: {
    marginTop: "0.5rem",
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "8px",
    padding: "0.5rem 1.25rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

export default ErrorBoundary;
