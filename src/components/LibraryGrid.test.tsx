import { render, screen } from "@testing-library/react";
import LibraryGrid from "./LibraryGrid";

describe("LibraryGrid", () => {
  it("renders children", () => {
    render(
      <LibraryGrid>
        <div data-testid="child-1">Item 1</div>
        <div data-testid="child-2">Item 2</div>
      </LibraryGrid>
    );

    expect(screen.getByTestId("child-1")).toBeInTheDocument();
    expect(screen.getByTestId("child-2")).toBeInTheDocument();
  });

  it("renders as a grid container", () => {
    const { container } = render(
      <LibraryGrid>
        <span>A</span>
      </LibraryGrid>
    );

    const grid = container.firstChild as HTMLElement;
    expect(grid.style.display).toBe("grid");
  });

  it("renders with multiple children", () => {
    render(
      <LibraryGrid>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} data-testid={`item-${i}`}>
            Item {i}
          </div>
        ))}
      </LibraryGrid>
    );

    for (let i = 0; i < 10; i++) {
      expect(screen.getByTestId(`item-${i}`)).toBeInTheDocument();
    }
  });
});
