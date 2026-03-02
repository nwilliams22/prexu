import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import SearchBar from "./SearchBar";

// Helper: wrap in BrowserRouter for react-router hooks
function renderSearchBar() {
  return render(
    <BrowserRouter>
      <SearchBar />
    </BrowserRouter>
  );
}

describe("SearchBar", () => {
  it("renders a text input with placeholder", () => {
    renderSearchBar();
    expect(
      screen.getByPlaceholderText("Search movies, shows, episodes...")
    ).toBeInTheDocument();
  });

  it("allows typing in the input", async () => {
    const user = userEvent.setup();
    renderSearchBar();

    const input = screen.getByPlaceholderText("Search movies, shows, episodes...");
    await user.type(input, "inception");

    expect(input).toHaveValue("inception");
  });

  it("shows clear button when input has value", async () => {
    const user = userEvent.setup();
    renderSearchBar();

    const input = screen.getByPlaceholderText("Search movies, shows, episodes...");
    await user.type(input, "test");

    expect(screen.getByLabelText("Clear search")).toBeInTheDocument();
  });

  it("does not show clear button when input is empty", () => {
    renderSearchBar();
    expect(screen.queryByLabelText("Clear search")).not.toBeInTheDocument();
  });

  it("clears input when clear button is clicked", async () => {
    const user = userEvent.setup();
    renderSearchBar();

    const input = screen.getByPlaceholderText("Search movies, shows, episodes...");
    await user.type(input, "test");
    await user.click(screen.getByLabelText("Clear search"));

    expect(input).toHaveValue("");
  });

  it("clears input on Escape key", async () => {
    const user = userEvent.setup();
    renderSearchBar();

    const input = screen.getByPlaceholderText("Search movies, shows, episodes...");
    await user.type(input, "test");
    await user.keyboard("{Escape}");

    expect(input).toHaveValue("");
  });

  it("renders a magnifying glass SVG icon", () => {
    const { container } = renderSearchBar();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
