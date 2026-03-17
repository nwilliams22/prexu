import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import LoadingGrid from "./LoadingGrid";
import { mockBreakpoint } from "../__tests__/test-utils";

describe("LoadingGrid", () => {
  beforeEach(() => {
    mockBreakpoint("desktop");
  });

  it("renders default 24 skeleton cards", () => {
    const { container } = render(<LoadingGrid />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.children).toHaveLength(24);
  });

  it("renders custom count", () => {
    const { container } = render(<LoadingGrid count={6} />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.children).toHaveLength(6);
  });

  it("wraps skeletons in library grid", () => {
    const { container } = render(<LoadingGrid />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.display).toBe("grid");
  });
});
