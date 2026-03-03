import { useState } from "react";
import SessionCreator from "./SessionCreator";

interface WatchTogetherButtonProps {
  ratingKey: string;
  title: string;
  mediaType: "movie" | "episode";
}

function WatchTogetherButton({
  ratingKey,
  title,
  mediaType,
}: WatchTogetherButtonProps) {
  const [showCreator, setShowCreator] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowCreator(true)}
        style={styles.button}
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginRight: "0.5rem" }}
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        Watch Together
      </button>

      {showCreator && (
        <SessionCreator
          ratingKey={ratingKey}
          title={title}
          mediaType={mediaType}
          onClose={() => setShowCreator(false)}
        />
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.65rem 1.5rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    borderRadius: "8px",
    border: "1px solid var(--accent)",
    background: "transparent",
    color: "var(--accent)",
    cursor: "pointer",
  },
};

export default WatchTogetherButton;
