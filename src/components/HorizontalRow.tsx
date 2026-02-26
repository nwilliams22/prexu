import { useRef, useState, useEffect, type ReactNode } from "react";

interface HorizontalRowProps {
  title: string;
  children: ReactNode;
  onSeeAll?: () => void;
}

function HorizontalRow({ title, children, onSeeAll }: HorizontalRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 10);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      observer.disconnect();
    };
  }, [children]);

  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.75;
    el.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  return (
    <section style={styles.section}>
      <div style={styles.header}>
        <h3 style={styles.title}>{title}</h3>
        {onSeeAll && (
          <button onClick={onSeeAll} style={styles.seeAll}>
            See All
          </button>
        )}
      </div>

      <div style={styles.scrollWrapper}>
        {/* Left arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            style={{ ...styles.scrollButton, left: 0 }}
            aria-label="Scroll left"
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}

        {/* Scroll container */}
        <div ref={scrollRef} className="hide-scrollbar" style={styles.scrollContainer}>
          {children}
        </div>

        {/* Right arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll("right")}
            style={{ ...styles.scrollButton, right: 0 }}
            aria-label="Scroll right"
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
        )}
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    marginBottom: "1.75rem",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.75rem",
  },
  title: {
    fontSize: "1.15rem",
    fontWeight: 600,
  },
  seeAll: {
    background: "transparent",
    color: "var(--accent)",
    fontSize: "0.85rem",
    padding: "0.25rem 0.5rem",
    borderRadius: "4px",
  },
  scrollWrapper: {
    position: "relative",
  },
  scrollContainer: {
    display: "flex",
    gap: "0.75rem",
    overflowX: "auto",
    overflowY: "hidden",
    scrollSnapType: "x mandatory",
    paddingBottom: "4px",
    scrollbarWidth: "none" as never,
  },
  scrollButton: {
    position: "absolute",
    top: 0,
    bottom: "30px", // accounts for text below image
    width: "36px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.7)",
    color: "var(--text-primary)",
    zIndex: 2,
    borderRadius: "4px",
    padding: 0,
  },
};

export default HorizontalRow;
