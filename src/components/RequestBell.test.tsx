import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RequestBell from "./RequestBell";

const mockNavigate = vi.fn();
let mockUnreadCount = 0;

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../hooks/useContentRequests", () => ({
  useContentRequests: () => ({
    unreadCount: mockUnreadCount,
    requests: [],
    isRelayConnected: false,
    submitRequest: vi.fn(),
    respondToRequest: vi.fn(),
    dismissRequest: vi.fn(),
    markAllRead: vi.fn(),
  }),
}));

describe("RequestBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnreadCount = 0;
  });

  it("renders a button", () => {
    render(<RequestBell />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it('has aria-label "Content requests" when no unread', () => {
    mockUnreadCount = 0;
    render(<RequestBell />);
    expect(
      screen.getByLabelText("Content requests")
    ).toBeInTheDocument();
  });

  it("has aria-label with unread count when there are unread", () => {
    mockUnreadCount = 5;
    render(<RequestBell />);
    expect(
      screen.getByLabelText("Content requests, 5 unread")
    ).toBeInTheDocument();
  });

  it("renders bell svg icon", () => {
    const { container } = render(<RequestBell />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not show badge when unread count is 0", () => {
    mockUnreadCount = 0;
    render(<RequestBell />);
    // No badge span should be present
    const button = screen.getByRole("button");
    const badge = button.querySelector("span");
    expect(badge).toBeNull();
  });

  it("shows badge with unread count", () => {
    mockUnreadCount = 3;
    render(<RequestBell />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows 99+ for counts over 99", () => {
    mockUnreadCount = 150;
    render(<RequestBell />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("shows exact count at 99", () => {
    mockUnreadCount = 99;
    render(<RequestBell />);
    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("navigates to /requests when clicked", async () => {
    const user = userEvent.setup();
    render(<RequestBell />);

    await user.click(screen.getByRole("button"));
    expect(mockNavigate).toHaveBeenCalledWith("/requests");
  });
});
