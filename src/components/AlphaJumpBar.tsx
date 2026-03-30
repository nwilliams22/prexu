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
  return (
    <nav style={styles.container} aria-label="Jump to letter">
      {LETTERS.map((letter) => {
        const hasItems = !availableLetters || availableLetters.has(letter);
        return (
          <button
            key={letter}
            onClick={() => onJump(letter)}
            style={{
              ...styles.letter,
              color: hasItems
                ? "var(--text-primary)"
                : "var(--text-secondary)",
              opacity: hasItems ? 1 : 0.3,
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
    right: "8px",
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1px",
    zIndex: 50,
    padding: "4px 2px",
    borderRadius: "8px",
    background: "rgba(0, 0, 0, 0.3)",
    backdropFilter: "blur(4px)",
  },
  letter: {
    width: "28px",
    height: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.8rem",
    fontWeight: 600,
    background: "transparent",
    color: "var(--text-primary)",
    border: "none",
    cursor: "pointer",
    padding: 0,
    borderRadius: "3px",
    transition: "color 0.1s",
  },
};

export { LETTERS };
export default AlphaJumpBar;
