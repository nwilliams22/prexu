import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueue } from "../../contexts/QueueContext";

interface QueuePanelProps {
  onClose: () => void;
  posterUrl: (path: string) => string;
}

export default function QueuePanel({ onClose, posterUrl }: QueuePanelProps) {
  const { queue, removeFromQueue, reorderQueue, clearQueue, remainingCount } = useQueue();
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleItemClick = useCallback(
    (ratingKey: string) => {
      onClose();
      navigate(`/play/${ratingKey}`);
    },
    [onClose, navigate],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index > 0) reorderQueue(index, index - 1);
    },
    [reorderQueue],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index < queue.items.length - 1) reorderQueue(index, index + 1);
    },
    [reorderQueue, queue.items.length],
  );

  const formatDuration = (ms: number): string => {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div
        ref={panelRef}
        style={styles.panel}
        role="dialog"
        aria-label="Playback queue"
      >
        <div style={styles.header}>
          <h3 style={styles.title}>
            Up Next
            {remainingCount > 0 && (
              <span style={styles.count}>{remainingCount}</span>
            )}
            {queue.shuffled && (
              <span style={styles.shuffleBadge} title="Shuffled">
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 3 21 3 21 8" />
                  <line x1={4} y1={20} x2={21} y2={3} />
                  <polyline points="21 16 21 21 16 21" />
                  <line x1={15} y1={15} x2={21} y2={21} />
                  <line x1={4} y1={4} x2={9} y2={9} />
                </svg>
              </span>
            )}
          </h3>
          <div style={styles.headerActions}>
            {queue.items.length > 0 && (
              <button onClick={clearQueue} style={styles.clearButton}>
                Clear
              </button>
            )}
            <button onClick={onClose} style={styles.closeButton} aria-label="Close">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1={18} y1={6} x2={6} y2={18} />
                <line x1={6} y1={6} x2={18} y2={18} />
              </svg>
            </button>
          </div>
        </div>

        <div style={styles.list} role="list">
          {queue.items.length === 0 && (
            <div style={styles.emptyState}>No items in queue</div>
          )}
          {queue.items.map((item, index) => {
            const isCurrent = index === queue.currentIndex;
            const isPast = index < queue.currentIndex;
            return (
              <div
                key={`${item.ratingKey}-${index}`}
                role="listitem"
                style={{
                  ...styles.item,
                  ...(isCurrent ? styles.itemCurrent : {}),
                  ...(isPast ? styles.itemPast : {}),
                }}
              >
                <button
                  onClick={() => handleItemClick(item.ratingKey)}
                  style={styles.itemContent}
                >
                  <img
                    src={posterUrl(item.thumb)}
                    alt=""
                    style={styles.thumb}
                  />
                  <div style={styles.itemInfo}>
                    <span style={styles.itemTitle}>
                      {isCurrent && (
                        <span style={styles.nowPlaying}>Now Playing</span>
                      )}
                      {item.subtitle}
                    </span>
                    <span style={styles.itemDuration}>
                      {formatDuration(item.duration)}
                    </span>
                  </div>
                </button>
                <div style={styles.itemActions}>
                  <button
                    onClick={() => handleMoveUp(index)}
                    style={styles.moveButton}
                    aria-label="Move up"
                    disabled={index === 0}
                  >
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    style={styles.moveButton}
                    aria-label="Move down"
                    disabled={index === queue.items.length - 1}
                  >
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  <button
                    onClick={() => removeFromQueue(index)}
                    style={styles.removeButton}
                    aria-label="Remove"
                  >
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <line x1={18} y1={6} x2={6} y2={18} />
                      <line x1={6} y1={6} x2={18} y2={18} />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
  },
  panel: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: "340px",
    maxWidth: "90vw",
    background: "rgba(15, 15, 15, 0.95)",
    backdropFilter: "blur(16px)",
    borderLeft: "1px solid rgba(255,255,255,0.1)",
    zIndex: 41,
    display: "flex",
    flexDirection: "column",
    animation: "slideLeft 0.2s ease-out",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1rem 1.25rem",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  title: {
    fontSize: "1rem",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  count: {
    fontSize: "0.75rem",
    fontWeight: 700,
    background: "var(--accent)",
    color: "#000",
    padding: "1px 6px",
    borderRadius: "10px",
  },
  shuffleBadge: {
    display: "inline-flex",
    alignItems: "center",
    color: "var(--accent)",
    opacity: 0.8,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  clearButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    fontSize: "0.8rem",
    cursor: "pointer",
    padding: "0.25rem 0.5rem",
  },
  closeButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    cursor: "pointer",
    padding: "0.25rem",
    display: "flex",
    alignItems: "center",
  },
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "0.5rem 0",
  },
  emptyState: {
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    textAlign: "center",
    padding: "2rem 1rem",
  },
  item: {
    display: "flex",
    alignItems: "center",
    padding: "0.4rem 0.75rem",
    transition: "background 0.1s ease",
  },
  itemCurrent: {
    background: "rgba(229, 160, 13, 0.1)",
    borderLeft: "3px solid var(--accent)",
  },
  itemPast: {
    opacity: 0.5,
  },
  itemContent: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    background: "transparent",
    border: "none",
    color: "var(--text-primary)",
    cursor: "pointer",
    padding: "0.25rem 0",
    textAlign: "left",
  },
  thumb: {
    width: "50px",
    height: "34px",
    borderRadius: "4px",
    objectFit: "cover",
    flexShrink: 0,
  },
  itemInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    overflow: "hidden",
    minWidth: 0,
  },
  itemTitle: {
    fontSize: "0.8rem",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  nowPlaying: {
    display: "block",
    fontSize: "0.65rem",
    fontWeight: 700,
    color: "var(--accent)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: "1px",
  },
  itemDuration: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
  },
  itemActions: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    flexShrink: 0,
  },
  moveButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    cursor: "pointer",
    padding: "4px",
    display: "flex",
    alignItems: "center",
    opacity: 0.6,
  },
  removeButton: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    cursor: "pointer",
    padding: "4px",
    display: "flex",
    alignItems: "center",
    opacity: 0.6,
    marginLeft: "2px",
  },
};
