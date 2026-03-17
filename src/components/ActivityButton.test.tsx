import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActivityButton from "./ActivityButton";

const mockUseServerActivity = vi.fn();

vi.mock("../hooks/useServerActivity", () => ({
  useServerActivity: () => mockUseServerActivity(),
}));

vi.mock("./ActivityPanel", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="activity-panel">
      <button onClick={onClose}>Close Panel</button>
    </div>
  ),
}));

describe("ActivityButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseServerActivity.mockReturnValue({
      isActive: false,
      sessions: [],
    });
  });

  it("renders the activity button", () => {
    render(<ActivityButton />);
    expect(screen.getByRole("button", { name: "Server activity" })).toBeInTheDocument();
  });

  it("shows 'Server activity' label when idle with no sessions", () => {
    render(<ActivityButton />);
    expect(screen.getByLabelText("Server activity")).toBeInTheDocument();
  });

  it("shows session count label for single active stream", () => {
    mockUseServerActivity.mockReturnValue({
      isActive: false,
      sessions: [{ id: "1" }],
    });
    render(<ActivityButton />);
    expect(screen.getByLabelText("1 active stream")).toBeInTheDocument();
  });

  it("shows plural session count label for multiple streams", () => {
    mockUseServerActivity.mockReturnValue({
      isActive: false,
      sessions: [{ id: "1" }, { id: "2" }, { id: "3" }],
    });
    render(<ActivityButton />);
    expect(screen.getByLabelText("3 active streams")).toBeInTheDocument();
  });

  it("shows 'Server activity in progress' when isActive", () => {
    mockUseServerActivity.mockReturnValue({
      isActive: true,
      sessions: [],
    });
    render(<ActivityButton />);
    expect(screen.getByLabelText("Server activity in progress")).toBeInTheDocument();
  });

  it("shows session count badge when sessions exist", () => {
    mockUseServerActivity.mockReturnValue({
      isActive: false,
      sessions: [{ id: "1" }, { id: "2" }],
    });
    render(<ActivityButton />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("does not show badge when no sessions", () => {
    render(<ActivityButton />);
    const button = screen.getByRole("button");
    // Badge span would have aria-hidden, we check there's no number text
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows 9+ for more than 9 sessions", () => {
    const sessions = Array.from({ length: 12 }, (_, i) => ({ id: String(i) }));
    mockUseServerActivity.mockReturnValue({
      isActive: false,
      sessions,
    });
    render(<ActivityButton />);
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("does not show ActivityPanel initially", () => {
    render(<ActivityButton />);
    expect(screen.queryByTestId("activity-panel")).not.toBeInTheDocument();
  });

  it("toggles ActivityPanel on click", async () => {
    const user = userEvent.setup();
    render(<ActivityButton />);

    const button = screen.getByRole("button", { name: "Server activity" });
    await user.click(button);
    expect(screen.getByTestId("activity-panel")).toBeInTheDocument();

    await user.click(button);
    expect(screen.queryByTestId("activity-panel")).not.toBeInTheDocument();
  });

  it("closes ActivityPanel when onClose is called", async () => {
    const user = userEvent.setup();
    render(<ActivityButton />);

    await user.click(screen.getByRole("button", { name: "Server activity" }));
    expect(screen.getByTestId("activity-panel")).toBeInTheDocument();

    await user.click(screen.getByText("Close Panel"));
    expect(screen.queryByTestId("activity-panel")).not.toBeInTheDocument();
  });

  it("has aria-expanded attribute", async () => {
    const user = userEvent.setup();
    render(<ActivityButton />);

    const button = screen.getByRole("button", { name: "Server activity" });
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("shows spinner SVG when isActive", () => {
    mockUseServerActivity.mockReturnValue({
      isActive: true,
      sessions: [],
    });
    const { container } = render(<ActivityButton />);
    // There should be 2 SVGs (spinner + icon) when active vs 1 when inactive
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(2);
  });

  it("does not show spinner when idle", () => {
    const { container } = render(<ActivityButton />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(1); // Just the activity icon
  });
});
