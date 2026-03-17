import { render, screen } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import BottomNav from "./BottomNav";

function renderBottomNav(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BottomNav />
    </MemoryRouter>
  );
}

describe("BottomNav", () => {
  it("renders all four tabs", () => {
    renderBottomNav();
    expect(screen.getByLabelText("Home")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(screen.getByLabelText("Library")).toBeInTheDocument();
    expect(screen.getByLabelText("Settings")).toBeInTheDocument();
  });

  it("renders tab labels", () => {
    renderBottomNav();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Library")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("highlights active tab based on current route", () => {
    renderBottomNav("/settings");
    const settingsTab = screen.getByLabelText("Settings");
    expect(settingsTab).toHaveStyle({ color: "var(--accent)" });
  });

  it("does not highlight inactive tabs", () => {
    renderBottomNav("/");
    const searchTab = screen.getByLabelText("Search");
    expect(searchTab).toHaveStyle({ color: "var(--text-secondary)" });
  });

  it("highlights Library tab for library sub-routes", () => {
    renderBottomNav("/library/123");
    const libraryTab = screen.getByLabelText("Library");
    expect(libraryTab).toHaveStyle({ color: "var(--accent)" });
  });

  it("renders with fixed bottom positioning", () => {
    const { container } = render(
      <BrowserRouter>
        <BottomNav />
      </BrowserRouter>
    );
    const nav = container.querySelector("nav");
    expect(nav).toHaveStyle({ position: "fixed", bottom: "0" });
  });

  it("each tab has minimum touch target size", () => {
    const { container } = render(
      <BrowserRouter>
        <BottomNav />
      </BrowserRouter>
    );
    const buttons = container.querySelectorAll("button");
    buttons.forEach((btn) => {
      expect(btn).toHaveStyle({ minWidth: "44px", minHeight: "44px" });
    });
  });

  it("has no axe violations", async () => {
    const { container } = renderBottomNav();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
