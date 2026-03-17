import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import NavButtons from "./NavButtons";

// Reset module-level state between tests by re-importing
// Since NavButtons uses module-level state, we need to be careful
beforeEach(() => {
  vi.resetModules();
});

function renderNavButtons(initialEntries: string[] = ["/"], initialIndex = 0) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <NavButtons />
      <Routes>
        {initialEntries.map((path) => (
          <Route key={path} path={path} element={<div data-testid={`page-${path}`}>{path}</div>} />
        ))}
      </Routes>
    </MemoryRouter>
  );
}

describe("NavButtons", () => {
  it("renders back and forward buttons", () => {
    renderNavButtons();
    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go forward" })).toBeInTheDocument();
  });

  it("both buttons are disabled on initial route", () => {
    renderNavButtons();
    expect(screen.getByRole("button", { name: "Go back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Go forward" })).toBeDisabled();
  });

  it("renders SVG icons inside buttons", () => {
    renderNavButtons();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    buttons.forEach((btn) => {
      expect(btn.querySelector("svg")).toBeTruthy();
    });
  });

  it("applies disabled style when buttons are disabled", () => {
    renderNavButtons();
    const backBtn = screen.getByRole("button", { name: "Go back" });
    expect(backBtn.style.opacity).toBe("0.3");
  });

  it("has accessible labels", () => {
    renderNavButtons();
    expect(screen.getByLabelText("Go back")).toBeInTheDocument();
    expect(screen.getByLabelText("Go forward")).toBeInTheDocument();
  });

  it("container uses flex layout", () => {
    const { container } = renderNavButtons();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.display).toBe("flex");
    expect(wrapper.style.alignItems).toBe("center");
  });
});
