import { memo } from "react";

interface SkeletonCardProps {
  width?: number;
  aspectRatio?: number;
  index?: number;
}

function SkeletonCard({ width = 160, aspectRatio = 1.5, index = 0 }: SkeletonCardProps) {
  const height = Math.round(width * aspectRatio);
  const delay = `${index * 0.1}s`;

  return (
    <div style={{ ...styles.card, width }}>
      <div className="shimmer" style={{ ...styles.image, height, animationDelay: delay }} />
      <div style={styles.textArea}>
        <div className="shimmer" style={{ ...styles.titleLine, animationDelay: delay }} />
        <div className="shimmer" style={{ ...styles.subtitleLine, animationDelay: delay }} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
  },
  image: {
    width: "100%",
    borderRadius: "8px",
  },
  textArea: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "0.4rem 0.15rem 0",
  },
  titleLine: {
    height: "12px",
    width: "80%",
    borderRadius: "3px",
  },
  subtitleLine: {
    height: "10px",
    width: "50%",
    borderRadius: "3px",
  },
};

export default memo(SkeletonCard);
