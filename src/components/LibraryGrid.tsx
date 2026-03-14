import type { ReactNode } from "react";
import { useBreakpoint } from "../hooks/useBreakpoint";
import type { Breakpoint } from "../hooks/useBreakpoint";

interface LibraryGridProps {
  children: ReactNode;
}

const GRID_MIN_WIDTH: Record<Breakpoint, string> = {
  mobile: "45%",
  tablet: "170px",
  desktop: "185px",
  large: "215px",
};

function LibraryGrid({ children }: LibraryGridProps) {
  const bp = useBreakpoint();
  const minWidth = GRID_MIN_WIDTH[bp];

  return (
    <div
      style={{
        ...styles.grid,
        gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}, 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: "grid",
    gap: "1.25rem 0.75rem",
  },
};

export default LibraryGrid;
