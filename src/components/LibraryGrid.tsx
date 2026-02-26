import type { ReactNode } from "react";

interface LibraryGridProps {
  children: ReactNode;
}

function LibraryGrid({ children }: LibraryGridProps) {
  return <div style={styles.grid}>{children}</div>;
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))",
    gap: "1.25rem 0.75rem",
  },
};

export default LibraryGrid;
