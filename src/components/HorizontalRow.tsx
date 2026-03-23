import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";
import { useBreakpoint, isDesktopOrAbove, isTabletOrBelow } from "../hooks/useBreakpoint";

interface HorizontalRowProps {
  title: string;
  children: ReactNode;
  onSeeAll?: () => void;
}

function HorizontalRow({ title, children, onSeeAll }: HorizontalRowProps) {
  const bp = useBreakpoint();
  const showScrollButtons = isDesktopOrAbove(bp);
  const isTouchDevice = isTabletOrBelow(bp);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // ── Swipe gesture handling (mobile/tablet) ──
  const touchStartX = useRef(0);
  const touchStartScrollLeft = useRef(0);
  const isSwiping = useRef(false);
  const swipeVelocity = useRef(0);
  const lastTouchX = useRef(0);
  const lastTouchTime = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isTouchDevice) return;
    const el = scrollRef.current;
    if (!el) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartScrollLeft.current = el.scrollLeft;
    isSwiping.current = true;
    swipeVelocity.current = 0;
    lastTouchX.current = e.touches[0].clientX;
    lastTouchTime.current = Date.now();
  }, [isTouchDevice]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isSwiping.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const currentX = e.touches[0].clientX;
    const diff = touchStartX.current - currentX;
    el.scrollLeft = touchStartScrollLeft.current + diff;

    // Track velocity for momentum
    const now = Date.now();
    const dt = now - lastTouchTime.current;
    if (dt > 0) {
      swipeVelocity.current = (lastTouchX.current - currentX) / dt;
    }
    lastTouchX.current = currentX;
    lastTouchTime.current = now;
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping.current) return;
    isSwiping.current = false;
    const el = scrollRef.current;
    if (!el) return;

    // Apply momentum scroll
    const velocity = swipeVelocity.current;
    if (Math.abs(velocity) > 0.3) {
      const momentum = velocity * 250;
      el.scrollBy({ left: momentum, behavior: "smooth" });
    }
  }, []);

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
  }, []);

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
    <section role="group" aria-label={title} style={styles.section}>
      <div style={styles.header}>
        <h3 style={styles.title}>{title}</h3>
        {onSeeAll && (
          <button onClick={onSeeAll} style={styles.seeAll}>
            See All
          </button>
        )}
      </div>

      <div style={styles.scrollWrapper}>
        {/* Left arrow — desktop/large only */}
        {showScrollButtons && (
          <button
            onClick={() => scroll("left")}
            style={{
              ...styles.scrollButton,
              left: 0,
              opacity: canScrollLeft ? 1 : 0,
              pointerEvents: canScrollLeft ? "auto" : "none",
            }}
            aria-label="Scroll left"
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}

        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="hide-scrollbar"
          style={styles.scrollContainer}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            const container = scrollRef.current;
            if (!container) return;
            const focusable = Array.from(
              container.querySelectorAll<HTMLElement>("button, [tabindex]"),
            );
            if (focusable.length === 0) return;
            const idx = focusable.indexOf(document.activeElement as HTMLElement);
            if (idx === -1) return;
            e.preventDefault();
            const next = e.key === "ArrowRight"
              ? focusable[Math.min(idx + 1, focusable.length - 1)]
              : focusable[Math.max(idx - 1, 0)];
            next.focus();
            next.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
          }}
        >
          {children}
        </div>

        {/* Right arrow — desktop/large only */}
        {showScrollButtons && (
          <button
            onClick={() => scroll("right")}
            style={{
              ...styles.scrollButton,
              right: 0,
              opacity: canScrollRight ? 1 : 0,
              pointerEvents: canScrollRight ? "auto" : "none",
            }}
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
    gap: "1rem",
    overflowX: "auto",
    overflowY: "hidden",
    scrollSnapType: "x mandatory",
    willChange: "scroll-position",
    padding: "6px 0 4px 0",
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
    transition: "opacity 0.2s ease",
  },
};

export default HorizontalRow;
