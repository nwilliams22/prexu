import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
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

  const resolutions: FilterOption[] = [
    { key: "1080", title: "1080p" },
    { key: "4k", title: "4K" },
  ];

  const defaultProps = {
    filters: {} as LibraryFilters,
    onFiltersChange: vi.fn(),
    genres,
    years,
    contentRatings,
    resolutions,
    isLoading: false,
    currentSort: "titleSort:asc",
    onSortChange: vi.fn(),
  };

  it("renders genre, year range, and content rating selects", () => {
    render(<FilterBar {...defaultProps} />);

    expect(screen.getByText("All Genres")).toBeInTheDocument();
    expect(screen.getByLabelText("Year from")).toBeInTheDocument();
    expect(screen.getByLabelText("Year to")).toBeInTheDocument();
    expect(screen.getByText("All Ratings")).toBeInTheDocument();
  });

  it("renders unwatched toggle button", () => {
    render(<FilterBar {...defaultProps} />);
    expect(screen.getByText("Unwatched")).toBeInTheDocument();
  });

  it("renders disabled controls when isLoading is true", () => {
    render(<FilterBar {...defaultProps} isLoading />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      expect(select).toBeDisabled();
    }
  });

  it("calls onFiltersChange when genre is selected", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(<FilterBar {...defaultProps} onFiltersChange={onFiltersChange} />);

    const genreSelect = screen.getAllByRole("combobox")[0];
    await user.selectOptions(genreSelect, "action");

    expect(onFiltersChange).toHaveBeenCalledWith({ genre: "action" });
  });

  it("calls onFiltersChange when year-from is selected", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(<FilterBar {...defaultProps} onFiltersChange={onFiltersChange} />);

    await user.selectOptions(screen.getByLabelText("Year from"), "2023");

    expect(onFiltersChange).toHaveBeenCalledWith({ yearMin: "2023" });
  });

  it("calls onFiltersChange when year-to is selected", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(<FilterBar {...defaultProps} onFiltersChange={onFiltersChange} />);

    await user.selectOptions(screen.getByLabelText("Year to"), "2024");

    expect(onFiltersChange).toHaveBeenCalledWith({ yearMax: "2024" });
  });

  it("merges yearMin into existing filters when year-from is changed", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const filters: LibraryFilters = { yearMax: "2024" };

    render(
      <FilterBar {...defaultProps} filters={filters} onFiltersChange={onFiltersChange} />
    );

    await user.selectOptions(screen.getByLabelText("Year from"), "2023");

    expect(onFiltersChange).toHaveBeenCalledWith({ yearMax: "2024", yearMin: "2023" });
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
      yearMin: "2024",
      yearMax: "2024",
    };

    render(<FilterBar {...defaultProps} filters={filters} />);

    // "Action" appears in both the select option and the chip;
    // use the remove button to verify chips exist
    expect(screen.getByLabelText("Remove Action filter")).toBeInTheDocument();
    // A single-year range (yearMin === yearMax) collapses to a single label.
    expect(screen.getByLabelText("Remove 2024 filter")).toBeInTheDocument();
  });

  it("shows a from–to chip label for a genuine year range", () => {
    const filters: LibraryFilters = { yearMin: "1980", yearMax: "1989" };

    render(<FilterBar {...defaultProps} filters={filters} />);

    expect(screen.getByLabelText("Remove 1980–1989 filter")).toBeInTheDocument();
  });

  it("shows an open-ended chip label when only yearMin is set", () => {
    const filters: LibraryFilters = { yearMin: "1980" };

    render(<FilterBar {...defaultProps} filters={filters} />);

    expect(screen.getByLabelText("Remove 1980+ filter")).toBeInTheDocument();
  });

  it("shows an open-ended chip label when only yearMax is set", () => {
    const filters: LibraryFilters = { yearMax: "1989" };

    render(<FilterBar {...defaultProps} filters={filters} />);

    expect(screen.getByLabelText("Remove –1989 filter")).toBeInTheDocument();
  });

  it("clears both yearMin and yearMax when the year-range chip is removed", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const filters: LibraryFilters = { genre: "action", yearMin: "1980", yearMax: "1989" };

    render(
      <FilterBar {...defaultProps} filters={filters} onFiltersChange={onFiltersChange} />
    );

    await user.click(screen.getByLabelText("Remove 1980–1989 filter"));

    expect(onFiltersChange).toHaveBeenCalledWith({ genre: "action" });
  });

  it("treats a year range as an active filter for the Clear Filters button", () => {
    const filters: LibraryFilters = { yearMin: "1980", yearMax: "1989" };

    render(<FilterBar {...defaultProps} filters={filters} />);
    expect(screen.getByText("Clear Filters")).toBeInTheDocument();
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
    const filters: LibraryFilters = { genre: "action", yearMin: "2024", yearMax: "2024" };

    render(
      <FilterBar {...defaultProps} filters={filters} onFiltersChange={onFiltersChange} />
    );

    await user.click(screen.getByLabelText("Remove Action filter"));
    expect(onFiltersChange).toHaveBeenCalledWith({ yearMin: "2024", yearMax: "2024" });
  });

  it("shows Unwatched chip when unwatched filter is active", () => {
    const filters: LibraryFilters = { unwatched: true };

    render(<FilterBar {...defaultProps} filters={filters} />);
    // Button text + chip text
    const unwatchedElements = screen.getAllByText("Unwatched");
    expect(unwatchedElements.length).toBeGreaterThanOrEqual(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(<FilterBar {...defaultProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
