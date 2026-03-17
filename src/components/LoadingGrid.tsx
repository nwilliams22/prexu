import { memo } from "react";
import SkeletonCard from "./SkeletonCard";
import LibraryGrid from "./LibraryGrid";

interface LoadingGridProps {
  /** Number of skeleton cards to show (default 24) */
  count?: number;
}

function LoadingGrid({ count = 24 }: LoadingGridProps) {
  return (
    <LibraryGrid>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </LibraryGrid>
  );
}

export default memo(LoadingGrid);
