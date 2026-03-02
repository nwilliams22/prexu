import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}

function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div style={styles.container}>
      <div style={styles.icon}>{icon}</div>
      <h3 style={styles.title}>{title}</h3>
      {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
      {action && (
        <button onClick={action.onClick} style={styles.button}>
          {action.label}
        </button>
      )}
    </div>
  );
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
  },
  icon: {
    color: "var(--text-secondary)",
    opacity: 0.5,
    marginBottom: "0.5rem",
  },
  title: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  subtitle: {
    margin: 0,
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    maxWidth: "400px",
    lineHeight: 1.5,
  },
  button: {
    marginTop: "0.5rem",
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: "6px",
    padding: "0.5rem 1.25rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

export default EmptyState;
