import { useState } from "react";

const LETTERS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

interface AlphaJumpBarProps {
  /** Called when a letter is clicked; receives the letter (or "#" for non-alpha) */
  onJump: (letter: string) => void;
  /** Optional set of available first letters to highlight active vs inactive */
  availableLetters?: Set<string>;
}

/**
 * Vertical alphabetical jump bar displayed on the right side of a library view.
 * Clicking a letter scrolls/jumps to items starting with that letter.
 * "#" represents items starting with numbers or special characters.
 */
function AlphaJumpBar({ onJump, availableLetters }: AlphaJumpBarProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  return (
    <nav style={styles.container} aria-label="Jump to letter">
      {LETTERS.map((letter, i) => {
        const hasItems = !availableLetters || availableLetters.has(letter);
        const isHovered = hasItems && hoveredIdx === i;
        const isActive = hasItems && activeIdx === i;
        return (
          <button
            key={letter}
            onClick={() => onJump(letter)}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => {
              setHoveredIdx((prev) => (prev === i ? null : prev));
              setActiveIdx((prev) => (prev === i ? null : prev));
            }}
            onMouseDown={() => setActiveIdx(i)}
            onMouseUp={() => setActiveIdx(null)}
            style={{
              ...styles.letter,
              color: isActive
                ? "#000"
                : hasItems
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
              opacity: hasItems ? 1 : 0.3,
              background: isActive
                ? "var(--accent)"
                : isHovered
                  ? "rgba(255, 255, 255, 0.1)"
                  : "transparent",
            }}
            aria-label={`Jump to ${letter === "#" ? "numbers" : letter}`}
            disabled={!hasItems}
          >
            {letter}
          </button>
        );
      })}
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    right: "10px",
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    zIndex: 50,
    padding: "8px 4px",
    borderRadius: "12px",
    background: "rgba(0, 0, 0, 0.4)",
    backdropFilter: "blur(6px)",
  },
  letter: {
    width: "44px",
    height: "30px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.9rem",
    fontWeight: 600,
    background: "transparent",
    color: "var(--text-primary)",
    border: "none",
    cursor: "pointer",
    padding: 0,
    borderRadius: "6px",
    transition: "background 0.1s, color 0.1s",
  },
};

export { LETTERS };
export default AlphaJumpBar;
