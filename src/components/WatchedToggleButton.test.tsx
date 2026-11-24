import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onWatchStateChangedDetail } from "../services/watch-state-events";
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
    mockMarkWatched.mockResolvedValue();
    mockMarkUnwatched.mockResolvedValue();
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

  it("marks an already watched item watched again and publishes a resume reset", async () => {
    const listener = vi.fn();
    const unsubscribe = onWatchStateChangedDetail(listener);
    const onToggled = vi.fn(() => {
      expect(listener).toHaveBeenCalledWith({ ratingKey: "123", viewOffsetMs: 0, reset: true });
    });
    render(<WatchedToggleButton ratingKey="123" isWatched={true} onToggled={onToggled} />);
    try {
      expect(screen.getByRole("button", { name: "Mark Unwatched" })).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button", { name: "Mark Watched" }));
      expect(mockMarkWatched).toHaveBeenCalledWith("https://plex.test", "token", "123");
      expect(mockMarkUnwatched).not.toHaveBeenCalled();
      expect(onToggled).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it("does not clear resume or refresh after a failed watched request", async () => {
    mockMarkWatched.mockRejectedValueOnce(new Error("offline"));
    const listener = vi.fn();
    const unsubscribe = onWatchStateChangedDetail(listener);
    const onToggled = vi.fn();
    render(<WatchedToggleButton ratingKey="123" isWatched={true} onToggled={onToggled} />);
    try {
      await userEvent.setup().click(screen.getByRole("button", { name: "Mark Watched" }));
      expect(listener).not.toHaveBeenCalled();
      expect(onToggled).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Mark Watched" })).toBeEnabled();
    } finally {
      unsubscribe();
    }
  });

  it("disables button during loading", async () => {
    let resolvePromise: () => void;
    mockMarkWatched.mockImplementation(
      () => new Promise<void>((resolve) => { resolvePromise = resolve; })
    );

    const user = userEvent.setup();
    render(<WatchedToggleButton ratingKey="123" isWatched={false} />);

    const button = screen.getByRole("button", { name: "Mark Watched" });
    await user.click(button);

    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark Unwatched" })).toBeDisabled();

    await act(async () => {
      resolvePromise!();
    });

    expect(button).not.toBeDisabled();
  });
});
