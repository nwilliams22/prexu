import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorBoundary from "./ErrorBoundary";

// A component that throws an error
function BrokenComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error message");
  }
  return <div>Working component</div>;
}

describe("ErrorBoundary", () => {
  // Suppress React error boundary console.error output in tests
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );

    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("shows error fallback when child throws", () => {
    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error message")).toBeInTheDocument();
  });

  it("shows default message when error has no message", () => {
    function EmptyErrorComponent(): React.ReactNode {
      throw new Error("");
    }

    render(
      <ErrorBoundary>
        <EmptyErrorComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows Try Again button in error state", () => {
    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Try Again")).toBeInTheDocument();
  });

  it("resets error state when Try Again is clicked", async () => {
    const user = userEvent.setup();

    // We need a component that can conditionally throw
    let shouldThrow = true;

    function ConditionalBroken() {
      if (shouldThrow) {
        throw new Error("Error!");
      }
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalBroken />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Fix the error
    shouldThrow = false;

    // Click Try Again — this resets the ErrorBoundary state
    await user.click(screen.getByText("Try Again"));

    // After reset, ErrorBoundary re-renders children
    // Since shouldThrow is false now, it should show "Recovered"
    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });

  it("renders SVG error icon in error state", () => {
    const { container } = render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
    );

    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
