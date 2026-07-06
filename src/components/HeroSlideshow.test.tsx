import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { mockBreakpoint } from "../__tests__/test-utils";
import HeroSlideshow, { type HeroSlide } from "./HeroSlideshow";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockLoggerDebug = vi.fn();
vi.mock("../services/logger", () => ({
  logger: {
    debug: (...args: unknown[]) => mockLoggerDebug(...args),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

function makeSlide(overrides: Partial<HeroSlide> = {}): HeroSlide {
  return {
    ratingKey: "1",
    title: "Test Movie",
    backdropUrl: "https://example.com/backdrop.jpg",
    ...overrides,
  };
}

describe("HeroSlideshow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockBreakpoint("desktop");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when slides array is empty", () => {
    const { container } = render(<HeroSlideshow slides={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the slide title", () => {
    render(<HeroSlideshow slides={[makeSlide({ title: "Inception" })]} />);
    expect(screen.getByText("Inception")).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(
      <HeroSlideshow
        slides={[makeSlide({ subtitle: "A mind-bending thriller" })]}
      />
    );
    expect(screen.getByText("A mind-bending thriller")).toBeInTheDocument();
  });

  it("renders summary when provided", () => {
    render(
      <HeroSlideshow
        slides={[makeSlide({ summary: "A thief who steals corporate secrets." })]}
      />
    );
    expect(
      screen.getByText("A thief who steals corporate secrets.")
    ).toBeInTheDocument();
  });

  it("truncates long summaries on desktop", () => {
    const longSummary = "A".repeat(250);
    render(<HeroSlideshow slides={[makeSlide({ summary: longSummary })]} />);
    // Should be truncated (max 200 chars on desktop)
    const summaryEl = screen.getByText(/A+/);
    expect(summaryEl.textContent!.length).toBeLessThan(250);
  });

  it('shows "Play" button when no progress', () => {
    render(<HeroSlideshow slides={[makeSlide()]} />);
    expect(screen.getByText("Play")).toBeInTheDocument();
  });

  it('shows "Continue" button when progress exists', () => {
    render(
      <HeroSlideshow slides={[makeSlide({ progress: 0.5 })]} />
    );
    expect(screen.getByText("Continue")).toBeInTheDocument();
  });

  it("displays rating when provided", () => {
    render(
      <HeroSlideshow slides={[makeSlide({ rating: 8.5 })]} />
    );
    expect(screen.getByText(/8\.5/)).toBeInTheDocument();
  });

  it("does not display rating when zero", () => {
    render(
      <HeroSlideshow slides={[makeSlide({ rating: 0 })]} />
    );
    expect(screen.queryByText(/★/)).not.toBeInTheDocument();
  });

  it("renders progress bar when progress > 0", () => {
    const { container } = render(
      <HeroSlideshow slides={[makeSlide({ progress: 0.4 })]} />
    );
    // Progress bar has width style set
    const progressBar = container.querySelector(
      '[style*="width: 40%"]'
    );
    expect(progressBar).toBeInTheDocument();
  });

  it("renders category label when provided", () => {
    render(
      <HeroSlideshow
        slides={[makeSlide({ category: "Continue Watching" })]}
      />
    );
    expect(screen.getByText("Continue Watching")).toBeInTheDocument();
  });

  it("renders dismiss button for recommended items", () => {
    const onDismiss = vi.fn();
    render(
      <HeroSlideshow
        slides={[makeSlide({ category: "Recommended for You" })]}
        onDismiss={onDismiss}
      />
    );
    expect(
      screen.getByLabelText("Dismiss recommendation")
    ).toBeInTheDocument();
  });

  it("does not render dismiss button for non-recommended categories", () => {
    const onDismiss = vi.fn();
    render(
      <HeroSlideshow
        slides={[makeSlide({ category: "Trending" })]}
        onDismiss={onDismiss}
      />
    );
    expect(
      screen.queryByLabelText("Dismiss recommendation")
    ).not.toBeInTheDocument();
  });

  it("calls onDismiss with ratingKey when dismiss clicked", () => {
    const onDismiss = vi.fn();
    render(
      <HeroSlideshow
        slides={[
          makeSlide({ ratingKey: "42", category: "Recommended for You" }),
        ]}
        onDismiss={onDismiss}
      />
    );

    fireEvent.click(screen.getByLabelText("Dismiss recommendation"));
    expect(onDismiss).toHaveBeenCalledWith("42");
  });

  it("calls onPlay when play button clicked", () => {
    const onPlay = vi.fn();
    render(
      <HeroSlideshow
        slides={[makeSlide({ ratingKey: "55" })]}
        onPlay={onPlay}
      />
    );

    fireEvent.click(screen.getByText("Play"));
    expect(onPlay).toHaveBeenCalledWith("55", expect.any(Object));
  });

  it("navigates to item page when play clicked without onPlay", () => {
    render(
      <HeroSlideshow slides={[makeSlide({ ratingKey: "77" })]} />
    );

    fireEvent.click(screen.getByText("Play"));
    expect(mockNavigate).toHaveBeenCalledWith("/item/77");
  });

  it("has carousel aria attributes", () => {
    render(<HeroSlideshow slides={[makeSlide()]} />);
    const region = screen.getByRole("region");
    expect(region.getAttribute("aria-label")).toBe(
      "Featured content slideshow"
    );
    expect(region.getAttribute("aria-roledescription")).toBe("carousel");
  });

  // Multi-slide behavior
  it("renders pagination dots for multiple slides", () => {
    render(
      <HeroSlideshow
        slides={[
          makeSlide({ ratingKey: "1", title: "Movie 1" }),
          makeSlide({ ratingKey: "2", title: "Movie 2" }),
        ]}
      />
    );
    expect(screen.getByLabelText("Go to slide 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Go to slide 2")).toBeInTheDocument();
  });

  it("does not render pagination dots for single slide", () => {
    render(<HeroSlideshow slides={[makeSlide()]} />);
    expect(screen.queryByLabelText("Go to slide 1")).not.toBeInTheDocument();
  });

  it("renders navigation arrows on desktop for multiple slides", () => {
    render(
      <HeroSlideshow
        slides={[
          makeSlide({ ratingKey: "1" }),
          makeSlide({ ratingKey: "2" }),
        ]}
      />
    );
    expect(screen.getByLabelText("Previous slide")).toBeInTheDocument();
    expect(screen.getByLabelText("Next slide")).toBeInTheDocument();
  });

  it("does not render navigation arrows on mobile", () => {
    mockBreakpoint("mobile");
    render(
      <HeroSlideshow
        slides={[
          makeSlide({ ratingKey: "1" }),
          makeSlide({ ratingKey: "2" }),
        ]}
      />
    );
    expect(screen.queryByLabelText("Previous slide")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Next slide")).not.toBeInTheDocument();
  });

  it("only mounts a backdrop for the first slide on initial render (prexu-r56j)", () => {
    // Pre-fix, every slide's backdrop (a full 1920x1080 background image)
    // mounted eagerly on first render — expensive when the hero has up to
    // 10 slides, and that render is what React Router's startTransition
    // waits on for the whole route change to become visible.
    render(
      <HeroSlideshow
        slides={[
          makeSlide({ ratingKey: "1", title: "First" }),
          makeSlide({ ratingKey: "2", title: "Second" }),
          makeSlide({ ratingKey: "3", title: "Third" }),
          makeSlide({ ratingKey: "4", title: "Fourth" }),
          makeSlide({ ratingKey: "5", title: "Fifth" }),
        ]}
      />,
    );

    // Backdrops are real <img> elements (prexu-200v — decoding="async"
    // needs an <img>, a CSS background-image div has no decode hint to set).
    const backdrops = screen.getAllByTestId("hero-backdrop");
    expect(backdrops.length).toBe(1);
  });

  it("mounts additional backdrops as slides are actually visited", () => {
    render(
      <HeroSlideshow
        slides={[
          makeSlide({ ratingKey: "1", title: "First" }),
          makeSlide({ ratingKey: "2", title: "Second" }),
          makeSlide({ ratingKey: "3", title: "Third" }),
        ]}
      />,
    );

    expect(screen.getAllByTestId("hero-backdrop").length).toBe(1);

    fireEvent.click(screen.getByLabelText("Go to slide 2"));

    // Slide 2 has now actually been visited, so its backdrop mounts too —
    // slide 3 (never visited) still doesn't.
    expect(screen.getAllByTestId("hero-backdrop").length).toBe(2);
  });

  it("gives the mounted backdrop <img> a decoding=\"async\" hint so decode never blocks a commit (prexu-200v)", () => {
    render(<HeroSlideshow slides={[makeSlide({ ratingKey: "1", title: "First" })]} />);
    const backdrop = screen.getByTestId("hero-backdrop");
    expect(backdrop.tagName).toBe("IMG");
    expect(backdrop.getAttribute("decoding")).toBe("async");
  });

  it("changes slide when dot is clicked", () => {
    render(
      <HeroSlideshow
        slides={[
          makeSlide({ ratingKey: "1", title: "First" }),
          makeSlide({ ratingKey: "2", title: "Second" }),
        ]}
      />
    );

    // Initially shows first slide
    expect(screen.getByText("First")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Go to slide 2"));
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  describe("commit timing instrumentation (prexu-200v)", () => {
    it("logs a commit-timing mark for HeroSlideshow's own first commit", () => {
      render(<HeroSlideshow slides={[makeSlide()]} />);
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        "dashboard",
        "hero backdrop committed",
        expect.objectContaining({ ms: expect.any(Number) }),
      );
    });

    it("logs a decode-timing mark once the first backdrop image loads", () => {
      render(<HeroSlideshow slides={[makeSlide()]} />);
      fireEvent.load(screen.getByTestId("hero-backdrop"));
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        "dashboard",
        "hero backdrop image loaded",
        expect.objectContaining({ ms: expect.any(Number) }),
      );
    });

    it("only logs the decode mark once even if the image fires load again", () => {
      render(<HeroSlideshow slides={[makeSlide()]} />);
      const backdrop = screen.getByTestId("hero-backdrop");
      fireEvent.load(backdrop);
      fireEvent.load(backdrop);
      const decodeCalls = mockLoggerDebug.mock.calls.filter(
        (call) => call[1] === "hero backdrop image loaded",
      );
      expect(decodeCalls.length).toBe(1);
    });
  });

  it("is wrapped in memo so Dashboard's staged shelf re-renders don't force a re-render (prexu-200v)", () => {
    // Dashboard's shelf-staging state changes 3 times after mount, but
    // HeroSlideshow's own props (slides/onDismiss/onPlay) are stable across
    // those transitions — memo() is what turns that stability into a
    // skipped re-render instead of a wasted diff of the whole hero subtree.
    expect(
      (HeroSlideshow as unknown as { $$typeof?: symbol }).$$typeof,
    ).toBe(Symbol.for("react.memo"));
  });
});
