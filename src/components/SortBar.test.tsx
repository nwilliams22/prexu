import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SortBar from "./SortBar";

describe("SortBar", () => {
  const defaultProps = {
    currentSort: "titleSort:asc",
    onSortChange: vi.fn(),
    totalCount: 42,
  };

  it("displays total count with default label", () => {
    render(<SortBar {...defaultProps} />);
    expect(screen.getByText("42 items")).toBeInTheDocument();
  });

  it("displays total count with custom label", () => {
    render(<SortBar {...defaultProps} label="movies" />);
    expect(screen.getByText("42 movies")).toBeInTheDocument();
  });

  it("formats large numbers with locale separator", () => {
    render(<SortBar {...defaultProps} totalCount={1234} />);
    // toLocaleString formats 1234 as "1,234" in en-US
    expect(screen.getByText(/1,234 items/)).toBeInTheDocument();
  });

  it("renders sort dropdown with options", () => {
    render(<SortBar {...defaultProps} />);
    const select = screen.getByLabelText("Sort by:");
    expect(select).toBeInTheDocument();

    // Check that all options are present
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(5);
    expect(options[0].textContent).toBe("Title");
    expect(options[1].textContent).toBe("Date Added");
    expect(options[2].textContent).toBe("Rating");
    expect(options[3].textContent).toBe("Year");
    expect(options[4].textContent).toBe("Release Date");
  });

  it("sets current sort value on select", () => {
    render(<SortBar {...defaultProps} currentSort="addedAt:desc" />);
    const select = screen.getByLabelText("Sort by:") as HTMLSelectElement;
    expect(select.value).toBe("addedAt:desc");
  });

  it("calls onSortChange when sort is changed", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();

    render(<SortBar {...defaultProps} onSortChange={onSortChange} />);
    const select = screen.getByLabelText("Sort by:");

    await user.selectOptions(select, "rating:desc");
    expect(onSortChange).toHaveBeenCalledWith("rating:desc");
  });
});
