import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WatchedToggleButton from "./WatchedToggleButton";

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://plex.test", accessToken: "token" },
  }),
}));

vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn(), dismissAll: vi.fn() }),
}));

const mockMarkWatched = vi.fn(() => Promise.resolve());
const mockMarkUnwatched = vi.fn(() => Promise.resolve());
vi.mock("../services/plex-library", () => ({
  markAsWatched: (...args: unknown[]) => mockMarkWatched(...args),
  markAsUnwatched: (...args: unknown[]) => mockMarkUnwatched(...args),
}));

describe("WatchedToggleButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Mark Watched' text when isWatched is false", () => {
    render(<WatchedToggleButton ratingKey="123" isWatched={false} />);
    expect(screen.getByText("Mark Watched")).toBeInTheDocument();
  });

  it("renders 'Mark Unwatched' text when isWatched is true", () => {
    render(<WatchedToggleButton ratingKey="123" isWatched={true} />);
    expect(screen.getByText("Mark Unwatched")).toBeInTheDocument();
  });

  it("calls markAsWatched when clicking an unwatched item", async () => {
    const user = userEvent.setup();
    render(<WatchedToggleButton ratingKey="456" isWatched={false} />);

    await user.click(screen.getByText("Mark Watched"));

    expect(mockMarkWatched).toHaveBeenCalledWith(
      "https://plex.test",
      "token",
      "456"
    );
    expect(mockMarkUnwatched).not.toHaveBeenCalled();
  });

  it("calls markAsUnwatched when clicking a watched item", async () => {
    const user = userEvent.setup();
    render(<WatchedToggleButton ratingKey="789" isWatched={true} />);

    await user.click(screen.getByText("Mark Unwatched"));

    expect(mockMarkUnwatched).toHaveBeenCalledWith(
      "https://plex.test",
      "token",
      "789"
    );
    expect(mockMarkWatched).not.toHaveBeenCalled();
  });

  it("calls onToggled callback after toggling", async () => {
    const onToggled = vi.fn();
    const user = userEvent.setup();
    render(
      <WatchedToggleButton
        ratingKey="123"
        isWatched={false}
        onToggled={onToggled}
      />
    );

    await user.click(screen.getByText("Mark Watched"));

    expect(onToggled).toHaveBeenCalledOnce();
  });

  it("disables button during loading", async () => {
    let resolvePromise: () => void;
    mockMarkWatched.mockImplementation(
      () => new Promise<void>((resolve) => { resolvePromise = resolve; })
    );

    const user = userEvent.setup();
    render(<WatchedToggleButton ratingKey="123" isWatched={false} />);

    const button = screen.getByRole("button");
    await user.click(button);

    expect(button).toBeDisabled();

    await act(async () => {
      resolvePromise!();
    });

    expect(button).not.toBeDisabled();
  });
});
