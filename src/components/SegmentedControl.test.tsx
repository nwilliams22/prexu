import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SegmentedControl from "./SegmentedControl";

const options = [
  { label: "Library", value: "library" },
  { label: "Collections", value: "collections" },
];

describe("SegmentedControl", () => {
  it("renders all option buttons", () => {
    render(<SegmentedControl options={options} value="library" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collections" })).toBeInTheDocument();
  });

  it("marks active option with aria-pressed=true", () => {
    render(<SegmentedControl options={options} value="library" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute("aria-pressed", "true");
  });

  it("marks inactive option with aria-pressed=false", () => {
    render(<SegmentedControl options={options} value="library" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Collections" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange when clicking inactive option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="library" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Collections" }));
    expect(onChange).toHaveBeenCalledWith("collections");
  });

  it("calls onChange when clicking same option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="library" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(onChange).toHaveBeenCalledWith("library");
  });

  it("applies custom style to container", () => {
    const { container } = render(
      <SegmentedControl
        options={options}
        value="library"
        onChange={() => {}}
        style={{ marginTop: "16px" }}
      />
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.marginTop).toBe("16px");
  });
});
