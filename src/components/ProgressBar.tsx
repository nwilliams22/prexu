import { memo } from "react";

interface ProgressBarProps {
  /** Progress value between 0 and 1 */
  value: number;
  /** Bar height in pixels (default 4) */
  height?: number;
  /** Additional container styles */
  style?: React.CSSProperties;
}

function ProgressBar({ value, height = 4, style }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, value));

  return (
    <div
      style={{
        ...styles.container,
        height,
        ...style,
      }}
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        style={{
          ...styles.fill,
          width: `${clamped * 100}%`,
          borderRadius: height / 2,
        }}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: "100%",
    maxWidth: "300px",
    background: "rgba(255,255,255,0.15)",
    borderRadius: "2px",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    background: "var(--accent)",
    transition: "width 0.3s ease",
  },
};

export default memo(ProgressBar);
