import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen } from "../__tests__/test-utils";
import userEvent from "@testing-library/user-event";
import { createWatchInvite } from "../__tests__/mocks/plex-data";
import InviteNotification from "./InviteNotification";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../hooks/useFocusTrap", () => ({
  useFocusTrap: vi.fn(),
}));

vi.mock("../utils/notificationSound", () => ({
  playNotificationSound: vi.fn(),
}));

const mockDismissInvite = vi.fn();

vi.mock("../hooks/useInvites", async () => {
  const actual = await vi.importActual("../hooks/useInvites");
  return {
    ...actual,
    useInvites: () => ({
      invites: mockInvites,
      dismissInvite: mockDismissInvite,
    }),
  };
});

let mockInvites: ReturnType<typeof createWatchInvite>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mockInvites = [];
});

describe("InviteNotification", () => {
  it("renders nothing when there are no invites", () => {
    mockInvites = [];
    const { container } = renderWithProviders(<InviteNotification />);
    expect(container.firstChild).toBeNull();
  });

  it("renders invite card with sender username", () => {
    mockInvites = [createWatchInvite({ senderUsername: "Alice" })];
    renderWithProviders(<InviteNotification />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders media title", () => {
    mockInvites = [createWatchInvite({ mediaTitle: "Inception" })];
    renderWithProviders(<InviteNotification />);
    expect(screen.getByText("Inception")).toBeInTheDocument();
  });

  it("renders invite label text", () => {
    mockInvites = [createWatchInvite()];
    renderWithProviders(<InviteNotification />);
    expect(screen.getByText("invited you to watch")).toBeInTheDocument();
  });

  it("renders Join Session and Decline buttons", () => {
    mockInvites = [createWatchInvite()];
    renderWithProviders(<InviteNotification />);
    expect(screen.getByText("Join Session")).toBeInTheDocument();
    expect(screen.getByText("Decline")).toBeInTheDocument();
  });

  it("has alertdialog role", () => {
    mockInvites = [createWatchInvite()];
    renderWithProviders(<InviteNotification />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("shows sender avatar image when senderThumb is provided", () => {
    mockInvites = [
      createWatchInvite({ senderThumb: "https://example.com/thumb.jpg" }),
    ];
    const { container } = renderWithProviders(<InviteNotification />);
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img!.getAttribute("src")).toBe("https://example.com/thumb.jpg");
  });

  it("shows avatar placeholder when senderThumb is not provided", () => {
    mockInvites = [
      createWatchInvite({
        senderUsername: "Bob",
        senderThumb: undefined,
      }),
    ];
    renderWithProviders(<InviteNotification />);
    // Placeholder shows first letter uppercase
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("calls dismissInvite when Decline is clicked", async () => {
    const invite = createWatchInvite();
    mockInvites = [invite];
    renderWithProviders(<InviteNotification />);

    const user = userEvent.setup();
    await user.click(screen.getByText("Decline"));
    expect(mockDismissInvite).toHaveBeenCalledWith(invite.sessionId);
  });

  it("navigates to play route when Join Session is clicked", async () => {
    const invite = createWatchInvite({
      mediaRatingKey: "999",
      sessionId: "sess-42",
      relayUrl: "ws://localhost/ws",
    });
    mockInvites = [invite];
    renderWithProviders(<InviteNotification />);

    const user = userEvent.setup();
    await user.click(screen.getByText("Join Session"));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining("/play/999")
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining("session=sess-42")
    );
  });

  it("does not show navigation when only one invite", () => {
    mockInvites = [createWatchInvite()];
    renderWithProviders(<InviteNotification />);
    expect(screen.queryByText(/of.*invites/)).not.toBeInTheDocument();
  });

  it("shows navigation controls for multiple invites", () => {
    mockInvites = [createWatchInvite(), createWatchInvite()];
    renderWithProviders(<InviteNotification />);
    expect(screen.getByText("1 of 2 invites")).toBeInTheDocument();
  });

  it("has aria-label with sender name", () => {
    mockInvites = [createWatchInvite({ senderUsername: "Charlie" })];
    renderWithProviders(<InviteNotification />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("aria-label")).toBe(
      "Watch invite from Charlie"
    );
  });
});
