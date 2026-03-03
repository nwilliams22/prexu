import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import PinEntryModal from "./PinEntryModal";

describe("PinEntryModal a11y", () => {
  const defaultProps = {
    userName: "Alice",
    userThumb: "/alice.jpg",
    error: null,
    isLoading: false,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  };

  it("has no axe violations", async () => {
    const { container } = render(<PinEntryModal {...defaultProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has dialog role with aria-modal", () => {
    const { container } = render(<PinEntryModal {...defaultProps} />);
    const dialog = container.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
  });

  it("has aria-labelledby pointing to the user name", () => {
    const { container } = render(<PinEntryModal {...defaultProps} />);
    const dialog = container.querySelector("[role='dialog']");
    const labelledBy = dialog?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const labelEl = document.getElementById(labelledBy!);
    expect(labelEl?.textContent).toBe("Alice");
  });
});
