import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import SearchBar from "./SearchBar";

function renderSearchBar() {
  return render(
    <BrowserRouter>
      <SearchBar />
    </BrowserRouter>
  );
}

describe("SearchBar a11y", () => {
  it("has no axe violations", async () => {
    const { container } = renderSearchBar();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has role=search on container", () => {
    renderSearchBar();
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("input has accessible label", () => {
    renderSearchBar();
    const input = screen.getByLabelText("Search movies, shows, episodes");
    expect(input).toBeInTheDocument();
  });

  it("magnifying glass SVG is hidden from screen readers", () => {
    const { container } = renderSearchBar();
    // The decorative SVG (not inside a button) should have aria-hidden
    const svgs = container.querySelectorAll("svg[aria-hidden='true']");
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });
});
