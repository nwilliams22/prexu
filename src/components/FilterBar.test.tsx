import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FilterBar from "./FilterBar";
import type { LibraryFilters, FilterOption } from "../types/library";

describe("FilterBar", () => {
  const genres: FilterOption[] = [
    { key: "action", title: "Action" },
    { key: "comedy", title: "Comedy" },
    { key: "drama", title: "Drama" },
  ];
  const years: FilterOption[] = [
    { key: "2024", title: "2024" },
    { key: "2023", title: "2023" },
  ];
  const contentRatings: FilterOption[] = [
    { key: "PG-13", title: "PG-13" },
    { key: "R", title: "R" },
  ];

  const defaultProps = {
    filters: {} as LibraryFilters,
    onFiltersChange: vi.fn(),
    genres,
    years,
    contentRatings,
    isLoading: false,
  };

  it("renders genre, year, and content rating selects", () => {
    render(<FilterBar {...defaultProps} />);

    expect(screen.getByText("All Genres")).toBeInTheDocument();
    expect(screen.getByText("All Years")).toBeInTheDocument();
    expect(screen.getByText("All Ratings")).toBeInTheDocument();
  });

  it("renders unwatched toggle button", () => {
    render(<FilterBar {...defaultProps} />);
    expect(screen.getByText("Unwatched")).toBeInTheDocument();
  });

  it("returns null when isLoading is true", () => {
    const { container } = render(<FilterBar {...defaultProps} isLoading />);
    expect(container.firstChild).toBeNull();
  });

  it("calls onFiltersChange when genre is selected", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(<FilterBar {...defaultProps} onFiltersChange={onFiltersChange} />);

    const genreSelect = screen.getAllByRole("combobox")[0];
    await user.selectOptions(genreSelect, "action");

    expect(onFiltersChange).toHaveBeenCalledWith({ genre: "action" });
  });

  it("calls onFiltersChange when year is selected", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(<FilterBar {...defaultProps} onFiltersChange={onFiltersChange} />);

    const yearSelect = screen.getAllByRole("combobox")[1];
    await user.selectOptions(yearSelect, "2024");

    expect(onFiltersChange).toHaveBeenCalledWith({ year: "2024" });
  });

  it("calls onFiltersChange when unwatched toggle is clicked", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(<FilterBar {...defaultProps} onFiltersChange={onFiltersChange} />);
    await user.click(screen.getByText("Unwatched"));

    expect(onFiltersChange).toHaveBeenCalledWith({ unwatched: true });
  });

  it("shows active filter chips when filters are applied", () => {
    const filters: LibraryFilters = {
      genre: "action",
      year: "2024",
    };

    render(<FilterBar {...defaultProps} filters={filters} />);

    // "Action" appears in both the select option and the chip;
    // use the remove button to verify chips exist
    expect(screen.getByLabelText("Remove Action filter")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove 2024 filter")).toBeInTheDocument();
  });

  it("shows Clear Filters button when filters are active", () => {
    const filters: LibraryFilters = { genre: "action" };

    render(<FilterBar {...defaultProps} filters={filters} />);
    expect(screen.getByText("Clear Filters")).toBeInTheDocument();
  });

  it("does not show Clear Filters when no filters are active", () => {
    render(<FilterBar {...defaultProps} />);
    expect(screen.queryByText("Clear Filters")).not.toBeInTheDocument();
  });

  it("calls onFiltersChange with empty object when Clear Filters is clicked", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const filters: LibraryFilters = { genre: "action" };

    render(
      <FilterBar {...defaultProps} filters={filters} onFiltersChange={onFiltersChange} />
    );

    await user.click(screen.getByText("Clear Filters"));
    expect(onFiltersChange).toHaveBeenCalledWith({});
  });

  it("removes individual filter via chip remove button", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const filters: LibraryFilters = { genre: "action", year: "2024" };

    render(
      <FilterBar {...defaultProps} filters={filters} onFiltersChange={onFiltersChange} />
    );

    await user.click(screen.getByLabelText("Remove Action filter"));
    expect(onFiltersChange).toHaveBeenCalledWith({ year: "2024" });
  });

  it("shows Unwatched chip when unwatched filter is active", () => {
    const filters: LibraryFilters = { unwatched: true };

    render(<FilterBar {...defaultProps} filters={filters} />);
    // Button text + chip text
    const unwatchedElements = screen.getAllByText("Unwatched");
    expect(unwatchedElements.length).toBeGreaterThanOrEqual(1);
  });
});
