import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import BottomNav from "./BottomNav";

function renderBottomNav(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>
  );
}

describe("BottomNav a11y", () => {
  it("has no axe violations", async () => {
    const { container } = renderBottomNav();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("nav has aria-label", () => {
    renderBottomNav();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
  });

  it("active tab has aria-current=page", () => {
    renderBottomNav("/");
    const homeBtn = screen.getByLabelText("Home");
    expect(homeBtn).toHaveAttribute("aria-current", "page");
  });

  it("inactive tabs do not have aria-current", () => {
    renderBottomNav("/");
    const searchBtn = screen.getByLabelText("Search");
    expect(searchBtn).not.toHaveAttribute("aria-current");
  });

  it("SVG icons are hidden from screen readers", () => {
    const { container } = renderBottomNav();
    const svgs = container.querySelectorAll("svg");
    svgs.forEach((svg) => {
      // SVGs should be wrapped in aria-hidden span
      const parent = svg.parentElement;
      expect(parent?.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
