import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ server: null, authToken: null, activeUser: null }),
}));

vi.mock("../hooks/useSearchSuggestions", () => ({
  useSearchSuggestions: () => ({
    suggestions: [{ ratingKey: "17", title: "Prexu QA Seasons", type: "show", thumb: "" }],
    isLoading: false,
  }),
}));

vi.mock("../services/storage", () => ({
  getRecentSearches: vi.fn(async () => ["Prexu QA Pattern"]),
  addRecentSearch: vi.fn(async () => []),
  removeRecentSearch: vi.fn(async () => []),
}));

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
    // First Escape closes the autocomplete dropdown, second clears input
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");

    expect(input).toHaveValue("");
  });

  it("renders a magnifying glass SVG icon", () => {
    const { container } = renderSearchBar();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});


describe("SearchBar pending navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  it.each(["pointer", "keyboard"])("keeps the selected detail route after %s selection", async (method) => {
    renderSearchBar();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Seasons" } });
    await act(() => vi.advanceTimersByTimeAsync(250));
    if (method === "pointer") {
      fireEvent.click(screen.getByRole("option", { name: /Seasons.*Show/ }));
    } else {
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    expect(window.location.pathname).toBe("/item/17");
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(window.location.pathname).toBe("/item/17");
  });

  it("keeps a clicked recent search instead of the pending typed query", async () => {
    renderSearchBar();
    const input = screen.getByRole("combobox");
    await act(async () => { fireEvent.focus(input); });
    fireEvent.change(input, { target: { value: "Prexu" } });
    fireEvent.click(screen.getByRole("option", { name: /QA Pattern/ }));
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Prexu QA Pattern");
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Prexu QA Pattern");
  });

  it("still navigates automatically when no result is selected", async () => {
    renderSearchBar();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Seasons" } });
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(window.location.pathname).toBe("/");
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(window.location.pathname + window.location.search).toBe("/search?q=Seasons");
  });
});
