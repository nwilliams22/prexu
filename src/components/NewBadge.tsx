interface NewBadgeProps {
  visible: boolean;
}

function NewBadge({ visible }: NewBadgeProps) {
  if (!visible) return null;

  return (
    <span
      aria-label="New content available"
      style={{
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: "var(--accent)",
        flexShrink: 0,
        marginLeft: "4px",
      }}
    />
  );
}

export default NewBadge;
