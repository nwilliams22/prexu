import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import PosterCard from "./PosterCard";

describe("PosterCard", () => {
  const defaultProps = {
    imageUrl: "/poster.jpg",
    title: "Inception",
  };

  it("renders title and image", () => {
    const { container } = render(<PosterCard {...defaultProps} />);

    expect(screen.getByText("Inception")).toBeInTheDocument();
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/poster.jpg");
  });

  it("renders subtitle when provided", () => {
    render(<PosterCard {...defaultProps} subtitle="2010" />);
    expect(screen.getByText("2010")).toBeInTheDocument();
  });

  it("does not render subtitle when not provided", () => {
    const { container } = render(<PosterCard {...defaultProps} />);
    // Only title span should exist in text container
    const textContainer = container.querySelector("span");
    expect(textContainer?.textContent).toBe("Inception");
  });

  it("renders badge when provided", () => {
    render(<PosterCard {...defaultProps} badge="+3 episodes" />);
    expect(screen.getByText("+3 episodes")).toBeInTheDocument();
  });

  it("does not render badge when not provided", () => {
    render(<PosterCard {...defaultProps} />);
    expect(screen.queryByText("+3 episodes")).not.toBeInTheDocument();
  });

  it("calls onClick when card is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<PosterCard {...defaultProps} onClick={onClick} />);
    await user.click(screen.getByText("Inception"));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders progress bar when progress > 0", () => {
    const { container } = render(
      <PosterCard {...defaultProps} progress={0.5} />
    );

    // Progress bar should be present with 50% width
    const progressBar = container.querySelector("[style*='width: 50%']");
    expect(progressBar).toBeInTheDocument();
  });

  it("does not render progress bar when progress is 0", () => {
    const { container } = render(
      <PosterCard {...defaultProps} progress={0} />
    );

    // No progress track should be present
    const progressElements = container.querySelectorAll("[style*='background: var(--accent)']");
    // Only badge could have accent background, but no badge here
    expect(progressElements.length).toBe(0);
  });

  it("does not render progress bar when progress is undefined", () => {
    const { container } = render(<PosterCard {...defaultProps} />);
    // No 5px progress track
    const trackElements = container.querySelectorAll("[style*='height: 5px']");
    expect(trackElements.length).toBe(0);
  });

  it("caps progress bar at 100%", () => {
    const { container } = render(
      <PosterCard {...defaultProps} progress={1.5} />
    );

    const progressBar = container.querySelector("[style*='width: 100%']");
    expect(progressBar).toBeInTheDocument();
  });

  it("shows skeleton before image loads", () => {
    const { container } = render(<PosterCard {...defaultProps} />);
    const skeleton = container.querySelector(".shimmer");
    expect(skeleton).toBeInTheDocument();
  });

  it("hides skeleton after image loads", () => {
    const { container } = render(<PosterCard {...defaultProps} />);

    const img = container.querySelector("img")!;
    fireEvent.load(img);

    const skeleton = container.querySelector(".shimmer");
    expect(skeleton).not.toBeInTheDocument();
  });

  it("handles image error by removing skeleton", () => {
    const { container } = render(<PosterCard {...defaultProps} />);

    const img = container.querySelector("img")!;
    fireEvent.error(img);

    const skeleton = container.querySelector(".shimmer");
    expect(skeleton).not.toBeInTheDocument();
  });

  it("handles context menu event", () => {
    const onContextMenu = vi.fn();
    render(<PosterCard {...defaultProps} onContextMenu={onContextMenu} />);

    const button = screen.getByRole("button");
    fireEvent.contextMenu(button);

    expect(onContextMenu).toHaveBeenCalledOnce();
  });

  it("shows more button when showMoreButton is true", () => {
    render(
      <PosterCard {...defaultProps} showMoreButton onMoreClick={() => {}} />
    );

    expect(screen.getByLabelText("More options")).toBeInTheDocument();
  });

  it("does not show more button when showMoreButton is false", () => {
    render(<PosterCard {...defaultProps} />);
    expect(screen.queryByLabelText("More options")).not.toBeInTheDocument();
  });

  it("calls onMoreClick when more button is clicked", () => {
    const onMoreClick = vi.fn();
    const onClick = vi.fn();

    render(
      <PosterCard
        {...defaultProps}
        showMoreButton
        onMoreClick={onMoreClick}
        onClick={onClick}
      />
    );

    // Use fireEvent since the button has pointerEvents:none when not hovered
    fireEvent.click(screen.getByLabelText("More options"));

    expect(onMoreClick).toHaveBeenCalledOnce();
    // onClick on the card should NOT have been called due to stopPropagation
    expect(onClick).not.toHaveBeenCalled();
  });

  it("calculates height from width and aspectRatio", () => {
    const { container } = render(
      <PosterCard {...defaultProps} width={200} aspectRatio={2} />
    );

    const imageContainer = container.querySelector("[style*='height']") as HTMLElement;
    expect(imageContainer).not.toBeNull();
    // 200 * 2 = 400
    expect(imageContainer.style.height).toBe("400px");
  });

  // ── Watched checkmark ──

  it("shows watched checkmark when watched is true", () => {
    render(<PosterCard {...defaultProps} watched />);
    expect(screen.getByLabelText("Watched")).toBeInTheDocument();
  });

  it("does not show watched checkmark when watched is false", () => {
    render(<PosterCard {...defaultProps} watched={false} />);
    expect(screen.queryByLabelText("Watched")).not.toBeInTheDocument();
  });

  it("does not show watched checkmark when watched is undefined", () => {
    render(<PosterCard {...defaultProps} />);
    expect(screen.queryByLabelText("Watched")).not.toBeInTheDocument();
  });

  // ── Unwatched count badge ──

  it("shows unwatched count badge when unwatchedCount > 0", () => {
    render(<PosterCard {...defaultProps} unwatchedCount={5} />);
    expect(screen.getByLabelText("5 unwatched")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("does not show unwatched badge when unwatchedCount is 0", () => {
    render(<PosterCard {...defaultProps} unwatchedCount={0} />);
    expect(screen.queryByLabelText(/unwatched/)).not.toBeInTheDocument();
  });

  it("does not show unwatched badge when unwatchedCount is undefined", () => {
    render(<PosterCard {...defaultProps} />);
    expect(screen.queryByLabelText(/unwatched/)).not.toBeInTheDocument();
  });

  it("has no axe violations with watched indicators", async () => {
    const { container } = render(
      <PosterCard {...defaultProps} watched unwatchedCount={3} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no axe violations", async () => {
    const { container } = render(<PosterCard {...defaultProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // prexu-yhg: dashboard shelves pass `index` so each tile's
  // cardEnter animation kicks off 30 ms after the previous one. This
  // is a perception win — the user sees tiles populating progressively
  // instead of all blinking in together. Cap is 8 tiles.
  describe("stagger animation-delay (index prop)", () => {
    it("applies no animation-delay when index is omitted (legacy callers)", () => {
      const { container } = render(<PosterCard {...defaultProps} />);
      const card = container.querySelector(".card-enter") as HTMLElement;
      expect(card.style.animationDelay).toBe("");
    });

    it("applies animation-delay = index * 30ms", () => {
      const { container } = render(<PosterCard {...defaultProps} index={3} />);
      const card = container.querySelector(".card-enter") as HTMLElement;
      expect(card.style.animationDelay).toBe("90ms");
    });

    it("caps the delay at MAX_STAGGER_INDEX (8 → 240ms)", () => {
      const { container } = render(<PosterCard {...defaultProps} index={50} />);
      const card = container.querySelector(".card-enter") as HTMLElement;
      expect(card.style.animationDelay).toBe("240ms");
    });

    it("clamps negative index to 0 (no delay)", () => {
      const { container } = render(<PosterCard {...defaultProps} index={-3} />);
      const card = container.querySelector(".card-enter") as HTMLElement;
      expect(card.style.animationDelay).toBe("");
    });

    it("index=0 omits animation-delay (no 0ms inline)", () => {
      const { container } = render(<PosterCard {...defaultProps} index={0} />);
      const card = container.querySelector(".card-enter") as HTMLElement;
      // 0 * 30 = 0, we suppress the inline style so the keyframe default
      // applies — keeps the rendered style tree clean.
      expect(card.style.animationDelay).toBe("");
    });
  });

  // ── Cache-complete image detection (prexu-kijk) ──
  //
  // jsdom never actually fetches/decodes images, so `HTMLImageElement`'s
  // `complete`/`naturalWidth` default to `false`/`0` and are never updated by
  // firing a synthetic 'load' event — the real browser race this guards
  // against (a cached image resolving before React's onLoad listener is
  // wired up) has to be simulated by shadowing those getters on the
  // prototype for the duration of each test, keyed by the node's `src` so
  // the placeholder and full-res layers can be driven independently.
  describe("cache-complete image detection", () => {
    const originalComplete = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "complete",
    );
    const originalNaturalWidth = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "naturalWidth",
    );

    afterEach(() => {
      if (originalComplete) {
        Object.defineProperty(HTMLImageElement.prototype, "complete", originalComplete);
      }
      if (originalNaturalWidth) {
        Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", originalNaturalWidth);
      }
    });

    /** Shadows `complete`/`naturalWidth` per-`src` so each <img> layer in the
     *  card can be driven independently (real browsers cache per-URL). */
    function mockImgStateBySrc(
      states: Record<string, { complete: boolean; naturalWidth: number }>,
    ) {
      Object.defineProperty(HTMLImageElement.prototype, "complete", {
        configurable: true,
        get(this: HTMLImageElement) {
          return states[this.getAttribute("src") ?? ""]?.complete ?? false;
        },
      });
      Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
        configurable: true,
        get(this: HTMLImageElement) {
          return states[this.getAttribute("src") ?? ""]?.naturalWidth ?? 0;
        },
      });
    }

    it("shows the full-res image immediately when already complete in cache at mount, without onLoad firing", () => {
      mockImgStateBySrc({
        [defaultProps.imageUrl]: { complete: true, naturalWidth: 200 },
      });

      const { container } = render(<PosterCard {...defaultProps} />);

      const img = container.querySelector(
        `img[src="${defaultProps.imageUrl}"]`,
      ) as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.style.opacity).toBe("1");
      // `loaded` being true clears the skeleton too.
      expect(container.querySelector(".shimmer")).not.toBeInTheDocument();
    });

    it("keeps the normal full-res path working when not yet complete at mount (onLoad still needed)", () => {
      mockImgStateBySrc({
        [defaultProps.imageUrl]: { complete: false, naturalWidth: 0 },
      });

      const { container } = render(<PosterCard {...defaultProps} />);

      const img = container.querySelector(
        `img[src="${defaultProps.imageUrl}"]`,
      ) as HTMLImageElement;
      expect(img.style.opacity).toBe("0");

      fireEvent.load(img);
      expect(img.style.opacity).toBe("1");
    });

    it("shows the blur placeholder's full opacity immediately when already complete in cache at mount", () => {
      mockImgStateBySrc({
        "/tiny.jpg": { complete: true, naturalWidth: 20 },
        [defaultProps.imageUrl]: { complete: false, naturalWidth: 0 },
      });

      const { container } = render(
        <PosterCard {...defaultProps} placeholderUrl="/tiny.jpg" />,
      );

      const placeholder = container.querySelector(
        'img[src="/tiny.jpg"]',
      ) as HTMLImageElement;
      expect(placeholder).toBeInTheDocument();
      expect(placeholder.style.opacity).toBe("1");
    });

    it("keeps the placeholder's normal onLoad path working when not yet complete at mount", () => {
      mockImgStateBySrc({
        "/tiny.jpg": { complete: false, naturalWidth: 0 },
        [defaultProps.imageUrl]: { complete: false, naturalWidth: 0 },
      });

      const { container } = render(
        <PosterCard {...defaultProps} placeholderUrl="/tiny.jpg" />,
      );

      const placeholder = container.querySelector(
        'img[src="/tiny.jpg"]',
      ) as HTMLImageElement;
      expect(placeholder.style.opacity).toBe("0");

      fireEvent.load(placeholder);
      expect(placeholder.style.opacity).toBe("1");
    });

    it("treats a cache-complete full-res image with naturalWidth=0 as an error, same as onError", () => {
      mockImgStateBySrc({
        [defaultProps.imageUrl]: { complete: true, naturalWidth: 0 },
      });

      const { container } = render(<PosterCard {...defaultProps} />);

      // hasError folds into `loaded`, clearing the skeleton — same as the
      // existing onError path.
      expect(container.querySelector(".shimmer")).not.toBeInTheDocument();
    });

    it("existing onError path (real error event) is unchanged", () => {
      mockImgStateBySrc({
        [defaultProps.imageUrl]: { complete: false, naturalWidth: 0 },
      });

      const { container } = render(<PosterCard {...defaultProps} />);
      const img = container.querySelector(
        `img[src="${defaultProps.imageUrl}"]`,
      ) as HTMLImageElement;

      fireEvent.error(img);
      expect(container.querySelector(".shimmer")).not.toBeInTheDocument();
    });
  });
});
