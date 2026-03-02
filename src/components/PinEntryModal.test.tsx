import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PinEntryModal from "./PinEntryModal";

describe("PinEntryModal", () => {
  const defaultProps = {
    userName: "Alice",
    userThumb: "/alice.jpg",
    error: null,
    isLoading: false,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  };

  it("displays user name and hint text", () => {
    render(<PinEntryModal {...defaultProps} />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Enter PIN to switch user")).toBeInTheDocument();
  });

  it("renders avatar image when userThumb is provided", () => {
    render(<PinEntryModal {...defaultProps} />);
    const img = screen.getByAltText("");
    expect(img).toHaveAttribute("src", "/alice.jpg");
  });

  it("renders fallback initial when userThumb is empty", () => {
    render(<PinEntryModal {...defaultProps} userThumb="" />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("accepts numeric input only", async () => {
    const user = userEvent.setup();
    render(<PinEntryModal {...defaultProps} />);

    const input = screen.getByPlaceholderText("PIN");
    await user.type(input, "12ab34");

    // Only digits should remain
    expect(input).toHaveValue("1234");
  });

  it("limits input to 4 characters", async () => {
    const user = userEvent.setup();
    render(<PinEntryModal {...defaultProps} />);

    const input = screen.getByPlaceholderText("PIN");
    await user.type(input, "123456");

    // maxLength=4 should limit to 4 digits
    expect((input as HTMLInputElement).value.length).toBeLessThanOrEqual(4);
  });

  it("calls onSubmit with PIN on form submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<PinEntryModal {...defaultProps} onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText("PIN");
    await user.type(input, "1234");
    await user.click(screen.getByText("Switch"));

    expect(onSubmit).toHaveBeenCalledWith("1234");
  });

  it("disables submit when PIN is empty", () => {
    render(<PinEntryModal {...defaultProps} />);
    const submitButton = screen.getByText("Switch");
    expect(submitButton).toBeDisabled();
  });

  it("disables inputs when isLoading is true", () => {
    render(<PinEntryModal {...defaultProps} isLoading />);

    const input = screen.getByPlaceholderText("PIN");
    expect(input).toBeDisabled();
    expect(screen.getByText("Switching...")).toBeInTheDocument();
  });

  it("calls onCancel when Cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<PinEntryModal {...defaultProps} onCancel={onCancel} />);
    await user.click(screen.getByText("Cancel"));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel on Escape key", () => {
    const onCancel = vi.fn();
    render(<PinEntryModal {...defaultProps} onCancel={onCancel} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    const { container } = render(
      <PinEntryModal {...defaultProps} onCancel={onCancel} />
    );

    // Click the backdrop (the outermost fixed div)
    const backdrop = container.firstChild as HTMLElement;
    await user.click(backdrop);

    expect(onCancel).toHaveBeenCalled();
  });

  it("displays error message when error is provided", () => {
    render(<PinEntryModal {...defaultProps} error="Incorrect PIN" />);
    expect(screen.getByText("Incorrect PIN")).toBeInTheDocument();
  });

  it("does not display error when error is null", () => {
    render(<PinEntryModal {...defaultProps} error={null} />);
    expect(screen.queryByText("Incorrect PIN")).not.toBeInTheDocument();
  });
});
