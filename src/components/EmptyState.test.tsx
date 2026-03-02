import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmptyState from "./EmptyState";

describe("EmptyState", () => {
  it("renders icon, title", () => {
    render(
      <EmptyState icon={<span data-testid="icon">🔍</span>} title="No results" />
    );

    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(
      <EmptyState
        icon={<span>📦</span>}
        title="Empty"
        subtitle="Try adding some items"
      />
    );

    expect(screen.getByText("Try adding some items")).toBeInTheDocument();
  });

  it("does not render subtitle when not provided", () => {
    render(<EmptyState icon={<span>📦</span>} title="Empty" />);
    // Only heading text, no paragraph
    expect(screen.queryByText("Try adding some items")).not.toBeInTheDocument();
  });

  it("renders action button when provided", () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon={<span>📦</span>}
        title="Empty"
        action={{ label: "Add Items", onClick }}
      />
    );

    expect(screen.getByText("Add Items")).toBeInTheDocument();
  });

  it("does not render action button when not provided", () => {
    render(<EmptyState icon={<span>📦</span>} title="Empty" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls action.onClick when button is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <EmptyState
        icon={<span>📦</span>}
        title="Empty"
        action={{ label: "Go", onClick }}
      />
    );

    await user.click(screen.getByText("Go"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
