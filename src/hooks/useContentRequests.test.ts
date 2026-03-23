import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useContentRequests, useContentRequestState } from "./useContentRequests";

// ── Mocks ──

const mockWatchSyncSend = vi.fn();
const mockWatchSyncOn = vi.fn(() => vi.fn()); // returns unsub
vi.mock("../services/watch-sync", () => ({
  watchSync: {
    send: (...args: unknown[]) => mockWatchSyncSend(...args),
    on: (...args: unknown[]) => mockWatchSyncOn(...args),
  },
}));

const mockGetContentRequests = vi.fn(() => Promise.resolve([]));
const mockSaveContentRequests = vi.fn();
const mockGetRequestsLastRead = vi.fn(() => Promise.resolve(0));
const mockSaveRequestsLastRead = vi.fn();
vi.mock("../services/storage", () => ({
  getContentRequests: () => mockGetContentRequests(),
  saveContentRequests: (...args: unknown[]) => mockSaveContentRequests(...args),
  getRequestsLastRead: () => mockGetRequestsLastRead(),
  saveRequestsLastRead: (...args: unknown[]) => mockSaveRequestsLastRead(...args),
}));

vi.mock("../utils/notificationSound", () => ({
  playNotificationSound: vi.fn(),
}));

// Stable mock for crypto.randomUUID
const mockUUID = "test-uuid-1234";
vi.stubGlobal("crypto", { randomUUID: () => mockUUID });

const adminUser = { id: 1, title: "Admin", username: "admin", thumb: "thumb.jpg", isAdmin: true, isHomeUser: true };
const regularUser = { id: 2, title: "User", username: "user", thumb: "uthumb.jpg", isAdmin: false, isHomeUser: true };

describe("useContentRequests (context hook)", () => {
  it("throws when used outside provider", () => {
    expect(() => {
      renderHook(() => useContentRequests());
    }).toThrow("useContentRequests must be used within ContentRequestProvider");
  });
});

describe("useContentRequestState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentRequests.mockResolvedValue([]);
    mockGetRequestsLastRead.mockResolvedValue(0);
    mockWatchSyncOn.mockReturnValue(vi.fn());
  });

  it("returns initial empty state", () => {
    const { result } = renderHook(() => useContentRequestState("token", adminUser));

    expect(result.current.requests).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.isRelayConnected).toBe(false);
  });

  it("loads persisted requests on mount", async () => {
    const stored = [{
      requestId: "r1",
      tmdbId: 123,
      mediaType: "movie" as const,
      title: "Test Movie",
      year: "2024",
      posterPath: null,
      overview: "A movie",
      requesterUsername: "user",
      requesterThumb: "",
      status: "pending" as const,
      requestedAt: 1000,
    }];
    mockGetContentRequests.mockResolvedValue(stored);

    const { result } = renderHook(() => useContentRequestState("token", adminUser));

    await waitFor(() => {
      expect(result.current.requests).toHaveLength(1);
    });

    expect(result.current.requests[0].title).toBe("Test Movie");
  });

  it("subscribes to relay events on mount", () => {
    renderHook(() => useContentRequestState("token", adminUser));

    // Should subscribe to: connected, disconnected, content_request_received, pending_content_requests, content_request_response
    expect(mockWatchSyncOn).toHaveBeenCalledWith("connected", expect.any(Function));
    expect(mockWatchSyncOn).toHaveBeenCalledWith("disconnected", expect.any(Function));
    expect(mockWatchSyncOn).toHaveBeenCalledWith("content_request_received", expect.any(Function));
    expect(mockWatchSyncOn).toHaveBeenCalledWith("pending_content_requests", expect.any(Function));
    expect(mockWatchSyncOn).toHaveBeenCalledWith("content_request_response", expect.any(Function));
  });

  it("submitRequest sends message via relay and stores locally", () => {
    const { result } = renderHook(() => useContentRequestState("token", regularUser));

    act(() => {
      result.current.submitRequest({
        tmdbId: 456,
        mediaType: "movie",
        title: "New Movie",
        year: "2025",
        posterPath: "/poster.jpg",
        overview: "Overview text",
      });
    });

    expect(mockWatchSyncSend).toHaveBeenCalledWith(expect.objectContaining({
      type: "content_request",
      tmdb_id: 456,
      title: "New Movie",
      requester_username: "User",
    }));

    expect(result.current.requests).toHaveLength(1);
    expect(result.current.requests[0].title).toBe("New Movie");
    expect(result.current.requests[0].status).toBe("pending");
  });

  it("submitRequest does nothing without activeUser", () => {
    const { result } = renderHook(() => useContentRequestState("token", null));

    act(() => {
      result.current.submitRequest({
        tmdbId: 456,
        mediaType: "movie",
        title: "New Movie",
        year: "2025",
        posterPath: null,
        overview: "Overview",
      });
    });

    expect(mockWatchSyncSend).not.toHaveBeenCalled();
    expect(result.current.requests).toHaveLength(0);
  });

  it("respondToRequest updates request status and sends relay message", () => {
    const { result } = renderHook(() => useContentRequestState("token", regularUser));

    // First submit a request
    act(() => {
      result.current.submitRequest({
        tmdbId: 789,
        mediaType: "tv",
        title: "A Show",
        year: "2024",
        posterPath: null,
        overview: "Show overview",
      });
    });

    const requestId = result.current.requests[0].requestId;

    act(() => {
      result.current.respondToRequest(requestId, "approved", "Looks good!");
    });

    expect(result.current.requests[0].status).toBe("approved");
    expect(result.current.requests[0].adminNote).toBe("Looks good!");
    expect(mockWatchSyncSend).toHaveBeenCalledWith(expect.objectContaining({
      type: "content_request_response",
      request_id: requestId,
      status: "approved",
      admin_note: "Looks good!",
    }));
  });

  it("dismissRequest removes request from list", () => {
    const { result } = renderHook(() => useContentRequestState("token", regularUser));

    act(() => {
      result.current.submitRequest({
        tmdbId: 100,
        mediaType: "movie",
        title: "Remove Me",
        year: "2024",
        posterPath: null,
        overview: "",
      });
    });

    expect(result.current.requests).toHaveLength(1);
    const id = result.current.requests[0].requestId;

    act(() => {
      result.current.dismissRequest(id);
    });

    expect(result.current.requests).toHaveLength(0);
  });

  it("markAllRead updates lastRead and persists", () => {
    const { result } = renderHook(() => useContentRequestState("token", adminUser));

    act(() => {
      result.current.markAllRead();
    });

    expect(mockSaveRequestsLastRead).toHaveBeenCalledWith(expect.any(Number));
  });

  it("unreadCount counts pending requests after lastRead for admin", async () => {
    const stored = [
      { requestId: "r1", tmdbId: 1, mediaType: "movie", title: "M1", year: "2024", posterPath: null, overview: "", requesterUsername: "u", requesterThumb: "", status: "pending", requestedAt: 5000 },
      { requestId: "r2", tmdbId: 2, mediaType: "movie", title: "M2", year: "2024", posterPath: null, overview: "", requesterUsername: "u", requesterThumb: "", status: "approved", requestedAt: 6000 },
    ];
    mockGetContentRequests.mockResolvedValue(stored);
    mockGetRequestsLastRead.mockResolvedValue(4000);

    const { result } = renderHook(() => useContentRequestState("token", adminUser));

    await waitFor(() => {
      expect(result.current.requests).toHaveLength(2);
    });

    // Only r1 is pending and after lastRead (4000)
    expect(result.current.unreadCount).toBe(1);
  });

  it("unreadCount is always 0 for non-admin", async () => {
    const stored = [
      { requestId: "r1", tmdbId: 1, mediaType: "movie", title: "M1", year: "2024", posterPath: null, overview: "", requesterUsername: "User", requesterThumb: "", status: "pending", requestedAt: 5000 },
    ];
    mockGetContentRequests.mockResolvedValue(stored);

    const { result } = renderHook(() => useContentRequestState("token", regularUser));

    await waitFor(() => {
      expect(result.current.requests).toHaveLength(1);
    });

    expect(result.current.unreadCount).toBe(0);
  });
});
