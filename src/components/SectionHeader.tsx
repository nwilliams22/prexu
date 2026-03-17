import { memo } from "react";

interface SectionHeaderProps {
  title: string;
  /** Optional item count displayed in secondary text */
  count?: number;
  /** Optional suffix for count (default: "item"/"items") */
  countSuffix?: string;
  /** Additional container styles */
  style?: React.CSSProperties;
}

function SectionHeader({ title, count, countSuffix, style }: SectionHeaderProps) {
  const suffix = countSuffix ?? (count === 1 ? "item" : "items");

  return (
    <h3 style={{ ...styles.heading, ...style }}>
      {title}
      {count !== undefined && (
        <span style={styles.count}>
          {count} {suffix}
        </span>
      )}
    </h3>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: {
    fontSize: "1.25rem",
    fontWeight: 600,
    marginBottom: "1rem",
    display: "flex",
    alignItems: "baseline",
    gap: "0.75rem",
  },
  count: {
    fontSize: "0.85rem",
    fontWeight: 400,
    color: "var(--text-secondary)",
  },
};

export default memo(SectionHeader);
