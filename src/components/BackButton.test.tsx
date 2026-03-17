import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import BackButton from "./BackButton";

describe("BackButton", () => {
  it("renders nothing at initial route (default key)", () => {
    const { container } = render(
      <MemoryRouter>
        <BackButton />
      </MemoryRouter>
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders button after navigation", () => {
    render(
      <MemoryRouter initialEntries={["/a", "/b"]} initialIndex={1}>
        <BackButton />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
  });

  it("has accessible label", () => {
    render(
      <MemoryRouter initialEntries={["/a", "/b"]} initialIndex={1}>
        <BackButton />
      </MemoryRouter>
    );
    expect(screen.getByLabelText("Go back")).toBeInTheDocument();
  });

  it("calls navigate(-1) on click", async () => {
    const user = userEvent.setup();
    let navigatedTo = "";

    function TestPage() {
      return <div data-testid="page-a">Page A</div>;
    }

    render(
      <MemoryRouter initialEntries={["/a", "/b"]} initialIndex={1}>
        <BackButton />
        <Routes>
          <Route path="/a" element={<TestPage />} />
          <Route path="/b" element={<div>Page B</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("page-a")).toBeInTheDocument();
  });
});
