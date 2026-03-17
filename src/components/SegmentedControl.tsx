import { memo } from "react";

interface SegmentedControlOption {
  label: string;
  value: string;
}

interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  /** Additional container styles */
  style?: React.CSSProperties;
}

function SegmentedControl({ options, value, onChange, style }: SegmentedControlProps) {
  return (
    <div style={{ ...styles.container, ...style }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          style={value === opt.value ? styles.active : styles.inactive}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    justifyContent: "center",
    gap: "6px",
  },
  active: {
    padding: "6px 20px",
    borderRadius: "6px",
    background: "var(--accent)",
    color: "#000",
    fontWeight: 600,
    fontSize: "0.85rem",
    border: "none",
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
  },
  inactive: {
    padding: "6px 20px",
    borderRadius: "6px",
    background: "transparent",
    color: "var(--text-secondary)",
    fontWeight: 500,
    fontSize: "0.85rem",
    border: "none",
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
  },
};

export default memo(SegmentedControl);
