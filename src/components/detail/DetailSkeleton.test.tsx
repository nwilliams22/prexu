import { render, screen } from "@testing-library/react";
import DetailSkeleton from "./DetailSkeleton";

describe("DetailSkeleton", () => {
  it("renders a detail-shaped loading placeholder marked as busy", () => {
    render(<DetailSkeleton />);

    const region = screen.getByLabelText("Loading item details");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-busy", "true");
  });
});
