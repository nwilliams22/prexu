import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import HorizontalRow from "./HorizontalRow";

describe("HorizontalRow", () => {
  it("renders the title heading", () => {
    render(
      <HorizontalRow title="Continue Watching">
        <div>Item</div>
      </HorizontalRow>
    );

    expect(screen.getByText("Continue Watching")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <HorizontalRow title="Row">
        <div data-testid="child-a">A</div>
        <div data-testid="child-b">B</div>
      </HorizontalRow>
    );

    expect(screen.getByTestId("child-a")).toBeInTheDocument();
    expect(screen.getByTestId("child-b")).toBeInTheDocument();
  });

  it("shows See All button when onSeeAll is provided", () => {
    render(
      <HorizontalRow title="Row" onSeeAll={() => {}}>
        <div>Item</div>
      </HorizontalRow>
    );

    expect(screen.getByText("See All")).toBeInTheDocument();
  });

  it("does not show See All button when onSeeAll is not provided", () => {
    render(
      <HorizontalRow title="Row">
        <div>Item</div>
      </HorizontalRow>
    );

    expect(screen.queryByText("See All")).not.toBeInTheDocument();
  });

  it("calls onSeeAll when See All button is clicked", async () => {
    const user = userEvent.setup();
    const onSeeAll = vi.fn();

    render(
      <HorizontalRow title="Row" onSeeAll={onSeeAll}>
        <div>Item</div>
      </HorizontalRow>
    );

    await user.click(screen.getByText("See All"));
    expect(onSeeAll).toHaveBeenCalledOnce();
  });

  it("renders scroll buttons", () => {
    render(
      <HorizontalRow title="Row">
        <div>Item</div>
      </HorizontalRow>
    );

    expect(screen.getByLabelText("Scroll left")).toBeInTheDocument();
    expect(screen.getByLabelText("Scroll right")).toBeInTheDocument();
  });

  it("wraps content in a section element", () => {
    const { container } = render(
      <HorizontalRow title="Row">
        <div>Item</div>
      </HorizontalRow>
    );

    expect(container.querySelector("section")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <HorizontalRow title="Test Row">
        <div>Item</div>
      </HorizontalRow>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
