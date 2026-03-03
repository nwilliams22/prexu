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

  it("has no axe violations", async () => {
    const { container } = render(<PosterCard {...defaultProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
