import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Requests from "./Requests";
import type { ContentRequest } from "../types/content-request";

// ── Stable mock values ──

const stableActiveUser = { id: 1, title: "Admin", username: "admin", thumb: "", isAdmin: true, isHomeUser: true };
const regularActiveUser = { id: 2, title: "User", username: "user", thumb: "", isAdmin: false, isHomeUser: true };

const mockRespondToRequest = vi.fn();
const mockDismissRequest = vi.fn();
const mockMarkAllRead = vi.fn();
let mockRequests: ContentRequest[] = [];
let mockIsRelayConnected = true;

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ activeUser: stableActiveUser }),
}));

vi.mock("../hooks/useContentRequests", () => ({
  useContentRequests: () => ({
    requests: mockRequests,
    respondToRequest: mockRespondToRequest,
    dismissRequest: mockDismissRequest,
    markAllRead: mockMarkAllRead,
    isRelayConnected: mockIsRelayConnected,
  }),
}));

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => "desktop",
  isMobile: () => false,
}));

vi.mock("../services/tmdb", () => ({
  getTmdbImageUrl: (path: string | null) => (path ? `https://image.tmdb.org/t/p/w92${path}` : null),
}));

vi.mock("../components/ContentRequestForm", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="request-form">
      <button onClick={onClose}>Close Form</button>
    </div>
  ),
}));

function renderPage(initialRoute = "/requests") {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Requests />
    </MemoryRouter>
  );
}

const pendingRequest: ContentRequest = {
  requestId: "r1",
  tmdbId: 123,
  mediaType: "movie",
  title: "Inception",
  year: "2010",
  posterPath: "/poster1.jpg",
  overview: "A mind-bending thriller about dreams within dreams.",
  requesterUsername: "kid_user",
  requesterThumb: "https://plex.tv/users/2/avatar",
  status: "pending",
  requestedAt: Date.now() - 86400000, // 1 day ago
};

const approvedRequest: ContentRequest = {
  requestId: "r2",
  tmdbId: 456,
  mediaType: "tv",
  title: "Breaking Bad",
  year: "2008",
  posterPath: "/poster2.jpg",
  overview: "A chemistry teacher turned meth cook.",
  requesterUsername: "friend",
  requesterThumb: "",
  status: "approved",
  requestedAt: Date.now() - 172800000,
  respondedAt: Date.now() - 100000,
  adminNote: "Great choice!",
};

const declinedRequest: ContentRequest = {
  requestId: "r3",
  tmdbId: 789,
  mediaType: "movie",
  title: "Bad Movie",
  year: "2023",
  posterPath: null,
  overview: "",
  requesterUsername: "guest",
  requesterThumb: "",
  status: "declined",
  requestedAt: Date.now() - 259200000,
  respondedAt: Date.now() - 200000,
};

describe("Requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequests = [pendingRequest, approvedRequest, declinedRequest];
    mockIsRelayConnected = true;
  });

  it("renders the page title for admin", () => {
    renderPage();
    expect(screen.getByText("Content Requests")).toBeInTheDocument();
  });

  it("renders page title for admin user", () => {
    renderPage();
    expect(screen.getByText("Content Requests")).toBeInTheDocument();
  });

  it("renders filter tabs", () => {
    renderPage();
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Declined")).toBeInTheDocument();
  });

  it("renders request cards with titles", () => {
    renderPage();
    expect(screen.getByText("Inception")).toBeInTheDocument();
    expect(screen.getByText("Breaking Bad")).toBeInTheDocument();
    expect(screen.getByText("Bad Movie")).toBeInTheDocument();
  });

  it("shows media type labels on cards", () => {
    renderPage();
    // Two movies (pending + declined) and one TV show (approved)
    expect(screen.getAllByText("Movie")).toHaveLength(2);
    expect(screen.getByText("TV Show")).toBeInTheDocument();
  });

  it("shows approve/decline buttons for pending requests (admin)", () => {
    renderPage();
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Decline")).toBeInTheDocument();
  });

  it("shows dismiss button for non-pending requests", () => {
    renderPage();
    const dismissButtons = screen.getAllByText("Dismiss");
    expect(dismissButtons).toHaveLength(2); // approved + declined
  });

  it("calls respondToRequest when Approve is clicked", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByText("Approve"));

    expect(mockRespondToRequest).toHaveBeenCalledWith("r1", "approved");
  });

  it("calls respondToRequest when Decline is clicked", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByText("Decline"));

    expect(mockRespondToRequest).toHaveBeenCalledWith("r1", "declined");
  });

  it("calls dismissRequest when Dismiss is clicked", async () => {
    renderPage();
    const user = userEvent.setup();

    const dismissButtons = screen.getAllByText("Dismiss");
    await user.click(dismissButtons[0]);

    expect(mockDismissRequest).toHaveBeenCalledWith("r2");
  });

  it("filters by pending tab", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByText("Pending"));

    expect(screen.getByText("Inception")).toBeInTheDocument();
    expect(screen.queryByText("Breaking Bad")).not.toBeInTheDocument();
    expect(screen.queryByText("Bad Movie")).not.toBeInTheDocument();
  });

  it("filters by approved tab", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByText("Approved"));

    expect(screen.queryByText("Inception")).not.toBeInTheDocument();
    expect(screen.getByText("Breaking Bad")).toBeInTheDocument();
    expect(screen.queryByText("Bad Movie")).not.toBeInTheDocument();
  });

  it("filters by declined tab", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByText("Declined"));

    expect(screen.queryByText("Inception")).not.toBeInTheDocument();
    expect(screen.queryByText("Breaking Bad")).not.toBeInTheDocument();
    expect(screen.getByText("Bad Movie")).toBeInTheDocument();
  });

  it("shows empty state when filtered list is empty", async () => {
    mockRequests = [];
    renderPage();

    expect(screen.getByText("No content requests yet.")).toBeInTheDocument();
  });

  it("shows filter-specific empty text", async () => {
    mockRequests = [pendingRequest]; // only pending
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByText("Approved"));

    expect(screen.getByText("No approved requests.")).toBeInTheDocument();
  });

  it("shows '+ Request Something' button", () => {
    renderPage();
    expect(screen.getByText("+ Request Something")).toBeInTheDocument();
  });

  it("opens request form when button is clicked", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByText("+ Request Something"));

    expect(screen.getByTestId("request-form")).toBeInTheDocument();
  });

  it("closes request form", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByText("+ Request Something"));
    expect(screen.getByTestId("request-form")).toBeInTheDocument();

    await user.click(screen.getByText("Close Form"));
    expect(screen.queryByTestId("request-form")).not.toBeInTheDocument();
  });

  it("shows requester info for admin view", () => {
    renderPage();
    expect(screen.getByText("kid_user")).toBeInTheDocument();
  });

  it("shows admin note on responded requests", () => {
    renderPage();
    expect(screen.getByText(/Great choice!/)).toBeInTheDocument();
  });

  it("shows relay warning when disconnected (admin)", () => {
    mockIsRelayConnected = false;
    renderPage();

    expect(screen.getByText(/Relay not connected/)).toBeInTheDocument();
  });

  it("does not show relay warning when connected", () => {
    mockIsRelayConnected = true;
    renderPage();

    expect(screen.queryByText(/Relay not connected/)).not.toBeInTheDocument();
  });

  it("displays filter counts in tabs", () => {
    renderPage();
    // The "All" tab should show count 3
    const allTab = screen.getByText("All").closest("button")!;
    expect(allTab.textContent).toContain("3");

    // "Pending" tab should show count 1
    const pendingTab = screen.getByText("Pending").closest("button")!;
    expect(pendingTab.textContent).toContain("1");
  });

  it("renders poster images when posterPath is set", () => {
    renderPage();
    const images = document.querySelectorAll("img");
    const posterImages = Array.from(images).filter((img) =>
      img.getAttribute("src")?.includes("image.tmdb.org")
    );
    expect(posterImages.length).toBeGreaterThanOrEqual(2);
  });

  it("auto-opens form when URL has query params", () => {
    renderPage("/requests?q=Taken&type=movie");
    expect(screen.getByTestId("request-form")).toBeInTheDocument();
  });
});
