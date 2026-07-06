import { render, screen } from "@testing-library/react";
import ShelfSkeleton from "./ShelfSkeleton";

describe("ShelfSkeleton", () => {
  it("renders a reserved-space placeholder hidden from assistive tech", () => {
    render(<ShelfSkeleton />);

    const region = screen.getByTestId("shelf-skeleton");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-hidden", "true");
  });

  it("suffixes the test id with the shelf name when provided, so different shelves are distinguishable in tests", () => {
    render(<ShelfSkeleton shelf="extras" />);

    expect(screen.getByTestId("shelf-skeleton-extras")).toBeInTheDocument();
    expect(screen.queryByTestId("shelf-skeleton")).not.toBeInTheDocument();
  });

  it("renders more placeholder shimmer as the requested card count grows", () => {
    // SkeletonCard renders a fixed shimmer trio (image/title/subtitle) per
    // card and has no test id of its own, so compare totals across two
    // counts rather than asserting an exact number tied to its internals.
    const { container: containerOf3 } = render(<ShelfSkeleton count={3} />);
    const { container: containerOf5 } = render(<ShelfSkeleton count={5} />);

    expect(containerOf5.querySelectorAll(".shimmer").length).toBeGreaterThan(
      containerOf3.querySelectorAll(".shimmer").length,
    );
  });
});
