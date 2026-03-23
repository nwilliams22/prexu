import { render, screen, fireEvent } from "@testing-library/react";
import ToastContainer from "./Toast";
import { ToastProvider } from "../hooks/useToast";
import type { ToastContextValue } from "../hooks/useToast";
import type { Toast } from "../types/toast";

function renderWithToasts(toasts: Toast[], dismiss = vi.fn(), dismissAll = vi.fn()) {
  const value: ToastContextValue = {
    toasts,
    toast: vi.fn(),
    dismiss,
    dismissAll,
  };

  return {
    dismiss,
    ...render(
      <ToastProvider value={value}>
        <ToastContainer />
      </ToastProvider>,
    ),
  };
}

describe("ToastContainer", () => {
  it("renders nothing when there are no toasts", () => {
    const { container } = renderWithToasts([]);
    expect(container.firstChild).toBeNull();
  });

  it("renders a success toast with correct role", () => {
    renderWithToasts([
      { id: "1", message: "Added to playlist", variant: "success", duration: 3000 },
    ]);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("Added to playlist");
  });

  it("renders an error toast", () => {
    renderWithToasts([
      { id: "1", message: "Something failed", variant: "error", duration: 3000 },
    ]);

    expect(screen.getByText("Something failed")).toBeInTheDocument();
  });

  it("renders an info toast", () => {
    renderWithToasts([
      { id: "1", message: "FYI", variant: "info", duration: 3000 },
    ]);

    expect(screen.getByText("FYI")).toBeInTheDocument();
  });

  it("renders multiple stacked toasts", () => {
    renderWithToasts([
      { id: "1", message: "First", variant: "success", duration: 3000 },
      { id: "2", message: "Second", variant: "error", duration: 3000 },
      { id: "3", message: "Third", variant: "info", duration: 3000 },
    ]);

    expect(screen.getAllByRole("alert")).toHaveLength(3);
  });

  it("calls dismiss when toast is clicked", () => {
    const dismiss = vi.fn();
    renderWithToasts(
      [{ id: "abc", message: "Click me", variant: "info", duration: 3000 }],
      dismiss,
    );

    fireEvent.click(screen.getByRole("alert"));
    expect(dismiss).toHaveBeenCalledWith("abc");
  });

  it("calls dismiss when close button is clicked", () => {
    const dismiss = vi.fn();
    renderWithToasts(
      [{ id: "def", message: "Close me", variant: "info", duration: 3000 }],
      dismiss,
    );

    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    expect(dismiss).toHaveBeenCalledWith("def");
  });
});
