import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useBreakpoint, isMobile, isTabletOrBelow } from "../hooks/useBreakpoint";

export interface HeroSlide {
  ratingKey: string;
  title: string;
  subtitle?: string;
  backdropUrl: string;
  summary?: string;
  progress?: number;
  year?: string;
  rating?: number;
  /** Category label shown above the title, e.g. "Continue Watching" */
  category?: string;
}

interface HeroSlideshowProps {
  slides: HeroSlide[];
  /** Called when user dismisses a recommendation (ratingKey) */
  onDismiss?: (ratingKey: string) => void;
  /** Called when user clicks Play/Continue — receives ratingKey and click event */
  onPlay?: (ratingKey: string, e: React.MouseEvent) => void;
}

const AUTO_ROTATE_MS = 8000;

function HeroSlideshow({ slides, onDismiss, onPlay }: HeroSlideshowProps) {
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const tablet = isTabletOrBelow(bp);
  const navigate = useNavigate();

  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showArrows, setShowArrows] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Preload next image
  useEffect(() => {
    if (slides.length <= 1) return;
    const nextIdx = (activeIndex + 1) % slides.length;
    const img = new Image();
    img.src = slides[nextIdx].backdropUrl;
  }, [activeIndex, slides]);

  // Auto-rotation
  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (isPaused || slides.length <= 1) return;
    timerRef.current = setTimeout(() => {
      setActiveIndex((prev) => (prev + 1) % slides.length);
    }, AUTO_ROTATE_MS);
  }, [isPaused, slides.length]);

  useEffect(() => {
    scheduleNext();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [scheduleNext, activeIndex]);

  // Clamp activeIndex if slides shrink
  useEffect(() => {
    if (activeIndex >= slides.length) setActiveIndex(0);
  }, [slides.length, activeIndex]);

  if (slides.length === 0) return null;

  const slide = slides[activeIndex];
  const heroHeight = mobile ? 380 : tablet ? 500 : 620;

  const goTo = (idx: number) => {
    setActiveIndex(idx);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const goPrev = () => goTo((activeIndex - 1 + slides.length) % slides.length);
  const goNext = () => goTo((activeIndex + 1) % slides.length);

  // Truncate summary
  const maxSummaryLen = mobile ? 100 : 200;
  const summary =
    slide.summary && slide.summary.length > maxSummaryLen
      ? slide.summary.slice(0, maxSummaryLen).replace(/\s+\S*$/, "") + "…"
      : slide.summary;

  return (
    <div
      style={{ ...styles.container, height: heroHeight }}
      onMouseEnter={() => {
        setIsPaused(true);
        setShowArrows(true);
      }}
      onMouseLeave={() => {
        setIsPaused(false);
        setShowArrows(false);
      }}
      role="region"
      aria-label="Featured content slideshow"
      aria-roledescription="carousel"
    >
      {/* Backdrop images — all rendered, only active is visible */}
      {slides.map((s, i) => (
        <div
          key={s.ratingKey}
          style={{
            ...styles.backdrop,
            backgroundImage: `url(${s.backdropUrl})`,
            opacity: i === activeIndex ? 1 : 0,
          }}
          aria-hidden={i !== activeIndex}
        />
      ))}

      {/* Gradient overlay */}
      <div style={styles.gradient} />

      {/* Content overlay */}
      <div
        style={{
          ...styles.content,
          padding: mobile ? "1rem 1rem 2.5rem" : "2rem 3rem 3rem",
        }}
      >
        {slide.category && (
          <div style={styles.categoryRow}>
            <span style={styles.category}>{slide.category}</span>
            {slide.category === "Recommended for You" && onDismiss && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Advance to next slide before removing
                  if (slides.length > 1) {
                    setActiveIndex((prev) =>
                      prev >= slides.length - 1 ? 0 : prev,
                    );
                  }
                  onDismiss(slide.ratingKey);
                }}
                style={styles.dismissButton}
                aria-label="Dismiss recommendation"
              >
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                <span>Not interested</span>
              </button>
            )}
          </div>
        )}

        <div
          onClick={() => navigate(`/item/${slide.ratingKey}`)}
          style={styles.clickableArea}
          role="link"
          aria-label={`View details for ${slide.title}`}
        >
          <h2
            style={{
              ...styles.title,
              fontSize: mobile ? "1.5rem" : tablet ? "2rem" : "2.5rem",
            }}
          >
            {slide.title}
          </h2>

          {slide.subtitle && (
            <p style={styles.subtitle}>{slide.subtitle}</p>
          )}

          {summary && (
            <p
              style={{
                ...styles.summary,
                maxWidth: mobile ? "100%" : "50%",
              }}
            >
              {summary}
            </p>
          )}
        </div>

        <div style={styles.actions}>
          {/* Play / View button */}
          <button
            onClick={(e) => {
              if (onPlay) {
                onPlay(slide.ratingKey, e);
              } else {
                navigate(`/item/${slide.ratingKey}`);
              }
            }}
            style={styles.playButton}
          >
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <polygon points="6,3 21,12 6,21" />
            </svg>
            <span>{slide.progress ? "Continue" : "Play"}</span>
          </button>

          {/* Rating */}
          {slide.rating !== undefined && slide.rating > 0 && (
            <span style={styles.rating}>
              ★ {slide.rating.toFixed(1)}
            </span>
          )}
        </div>

        {/* Progress bar (for continue watching items) */}
        {slide.progress !== undefined && slide.progress > 0 && (
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressBar,
                width: `${Math.min(slide.progress * 100, 100)}%`,
              }}
            />
          </div>
        )}
      </div>

      {/* Navigation arrows (desktop only, on hover) */}
      {!mobile && slides.length > 1 && (
        <>
          <button
            onClick={goPrev}
            style={{
              ...styles.arrow,
              ...styles.arrowLeft,
              opacity: showArrows ? 1 : 0,
              pointerEvents: showArrows ? "auto" : "none",
            }}
            aria-label="Previous slide"
          >
            <svg
              width={24}
              height={24}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            onClick={goNext}
            style={{
              ...styles.arrow,
              ...styles.arrowRight,
              opacity: showArrows ? 1 : 0,
              pointerEvents: showArrows ? "auto" : "none",
            }}
            aria-label="Next slide"
          >
            <svg
              width={24}
              height={24}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
        </>
      )}

      {/* Pagination dots */}
      {slides.length > 1 && (
        <div style={styles.dots}>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              style={{
                ...styles.dot,
                background:
                  i === activeIndex
                    ? "var(--accent)"
                    : "rgba(255,255,255,0.4)",
                width: i === activeIndex ? 24 : 8,
              }}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === activeIndex ? "true" : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
    borderRadius: "12px",
    marginBottom: "1.5rem",
  },
  backdrop: {
    position: "absolute",
    inset: 0,
    backgroundSize: "cover",
    backgroundPosition: "center top",
    transition: "opacity 0.8s ease",
  },
  gradient: {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(to top, var(--bg-primary) 0%, rgba(0,0,0,0.3) 40%, transparent 70%)",
  },
  content: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    zIndex: 2,
  },
  categoryRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  category: {
    fontSize: "0.8rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--accent)",
    textShadow: "0 1px 4px rgba(0,0,0,0.5)",
  },
  dismissButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    padding: "0.2rem 0.6rem",
    borderRadius: "4px",
    background: "rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.7)",
    fontSize: "0.75rem",
    fontWeight: 500,
    border: "none",
    cursor: "pointer",
    backdropFilter: "blur(4px)",
    transition: "background 0.15s ease, color 0.15s ease",
  },
  title: {
    fontWeight: 700,
    color: "#fff",
    textShadow: "0 2px 8px rgba(0,0,0,0.6)",
    margin: 0,
    lineHeight: 1.15,
  },
  subtitle: {
    fontSize: "1rem",
    color: "rgba(255,255,255,0.8)",
    margin: 0,
  },
  summary: {
    fontSize: "0.9rem",
    color: "rgba(255,255,255,0.7)",
    lineHeight: 1.5,
    margin: 0,
  },
  clickableArea: {
    cursor: "pointer",
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.5rem",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginTop: "0.25rem",
  },
  playButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.6rem 1.5rem",
    borderRadius: "8px",
    background: "var(--accent)",
    color: "#000",
    fontWeight: 600,
    fontSize: "0.95rem",
    border: "none",
    cursor: "pointer",
  },
  rating: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "var(--accent)",
  },
  progressTrack: {
    width: "200px",
    maxWidth: "50%",
    height: "4px",
    background: "rgba(255,255,255,0.2)",
    borderRadius: "2px",
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    background: "var(--accent)",
    borderRadius: "2px",
  },
  arrow: {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    background: "rgba(0,0,0,0.6)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: "none",
    cursor: "pointer",
    transition: "opacity 0.2s ease",
    zIndex: 3,
    backdropFilter: "blur(4px)",
  },
  arrowLeft: {
    left: "12px",
  },
  arrowRight: {
    right: "12px",
  },
  dots: {
    position: "absolute",
    bottom: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    gap: "6px",
    alignItems: "center",
    zIndex: 3,
  },
  dot: {
    height: "8px",
    borderRadius: "4px",
    border: "none",
    padding: 0,
    cursor: "pointer",
    transition: "width 0.3s ease, background 0.3s ease",
  },
};

export default HeroSlideshow;
