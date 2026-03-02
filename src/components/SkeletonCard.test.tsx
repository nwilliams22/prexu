import { render } from "@testing-library/react";
import SkeletonCard from "./SkeletonCard";

describe("SkeletonCard", () => {
  it("renders shimmer elements", () => {
    const { container } = render(<SkeletonCard />);
    const shimmers = container.querySelectorAll(".shimmer");
    // image shimmer + title line + subtitle line
    expect(shimmers.length).toBe(3);
  });

  it("uses default width of 160", () => {
    const { container } = render(<SkeletonCard />);
    const card = container.firstChild as HTMLElement;
    expect(card.style.width).toBe("160px");
  });

  it("respects custom width", () => {
    const { container } = render(<SkeletonCard width={200} />);
    const card = container.firstChild as HTMLElement;
    expect(card.style.width).toBe("200px");
  });

  it("calculates height from width * aspectRatio", () => {
    const { container } = render(<SkeletonCard width={100} aspectRatio={2} />);
    const imageShimmer = container.querySelector(".shimmer") as HTMLElement;
    expect(imageShimmer.style.height).toBe("200px");
  });

  it("uses default aspectRatio of 1.5", () => {
    const { container } = render(<SkeletonCard width={100} />);
    const imageShimmer = container.querySelector(".shimmer") as HTMLElement;
    expect(imageShimmer.style.height).toBe("150px");
  });

  it("applies animation delay from index", () => {
    // Use index=5 to avoid floating-point precision issues (5 * 0.1 = 0.5 exactly)
    const { container } = render(<SkeletonCard index={5} />);
    const shimmers = container.querySelectorAll(".shimmer");
    shimmers.forEach((el) => {
      expect((el as HTMLElement).style.animationDelay).toBe("0.5s");
    });
  });

  it("uses index 0 by default (no delay)", () => {
    const { container } = render(<SkeletonCard />);
    const shimmers = container.querySelectorAll(".shimmer");
    shimmers.forEach((el) => {
      expect((el as HTMLElement).style.animationDelay).toBe("0s");
    });
  });
});
