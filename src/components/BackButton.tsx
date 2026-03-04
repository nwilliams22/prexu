import { useNavigate, useLocation } from "react-router-dom";

/**
 * Global back-navigation button shown in the AppLayout header.
 * Only renders when there is real navigation history to go back to
 * (location.key !== "default" means the user navigated at least once).
 */
function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  // "default" key = direct entry / no history
  if (location.key === "default") return null;

  return (
    <button
      onClick={() => navigate(-1)}
      style={styles.button}
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
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    background: "transparent",
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.25rem",
    flexShrink: 0,
    cursor: "pointer",
    borderRadius: "4px",
  },
};

export default BackButton;
