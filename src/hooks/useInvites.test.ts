import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { parseInvite } from "../services/watch-sync";
import { useInvites, useInviteState } from "./useInvites";

// ── Mocks ──

// Capture the event handlers useInviteState registers so tests can drive
// state changes by invoking them directly (mirrors the watch-sync event bus).
const registeredHandlers: Record<string, (data?: unknown) => void> = {};
const mockWatchSyncOn = vi.fn((event: string, cb: (data?: unknown) => void) => {
  registeredHandlers[event] = cb;
  return vi.fn(); // unsubscribe
});
const mockWatchSyncConnect = vi.fn();
const mockWatchSyncDisconnect = vi.fn();
vi.mock("../services/watch-sync", async (original) => ({
  parseInvite: (await original<typeof import("../services/watch-sync")>()).parseInvite,
  watchSync: {
    on: (...args: [string, (data?: unknown) => void]) => mockWatchSyncOn(...args),
    connect: (...args: unknown[]) => mockWatchSyncConnect(...args),
    disconnect: (...args: unknown[]) => mockWatchSyncDisconnect(...args),
  },
}));

vi.mock("../services/plex-api", () => ({
  getPlexUser: vi.fn(() =>
    Promise.resolve({ username: "tester", thumb: "thumb.jpg" }),
  ),
}));

vi.mock("../services/storage", () => ({
  getRelayUrl: vi.fn(() => Promise.resolve("ws://relay.test")),
}));

vi.mock("../utils/notificationSound", () => ({
  playNotificationSound: vi.fn(),
}));

vi.mock("../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

describe("useInvites (context hook)", () => {
  it("throws when used outside provider", () => {
    expect(() => {
      renderHook(() => useInvites());
    }).toThrow("useInvites must be used within InviteProvider");
  });
});

// Regression for prexu-9f4s.1: the context value must keep a stable identity
// across re-renders that don't change its state, so AppProviders' unrelated
// high-frequency re-renders don't re-render every Invite consumer.
describe("useInviteState — context value identity (prexu-9f4s.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(registeredHandlers)) {
      delete registeredHandlers[key];
    }
    // vi.clearAllMocks() clears call history but NOT the implementation, so
    // re-prime the handler-capturing impl for each test.
    mockWatchSyncOn.mockImplementation(
      (event: string, cb: (data?: unknown) => void) => {
        registeredHandlers[event] = cb;
        return vi.fn();
      },
    );
  });

  it("returns a stable object across a re-render that doesn't change its state", () => {
    const { result, rerender } = renderHook(() =>
      useInviteState("token", null),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("returns a new object when its own state changes (relay connects)", () => {
    const { result } = renderHook(() => useInviteState("token", null));
    const before = result.current;
    act(() => {
      registeredHandlers["connected"]?.();
    });
    expect(result.current.isRelayConnected).toBe(true);
    expect(result.current).not.toBe(before);
  });
});

it("revokes only the matching pending invite", () => {
  const { result } = renderHook(() => useInviteState(null));
  const raw = { type: "invite_received" as const, session_id: "one", media_title: "QA", media_rating_key: "2", media_type: "movie", sender_username: "host", sender_thumb: "", sent_at: 1, relay_url: "ws://relay.test" };
  act(() => {
    registeredHandlers.invite_received(raw);
    registeredHandlers.invite_received({ ...raw, session_id: "two" });
  });
  expect(result.current.invites).toHaveLength(2);
  act(() => registeredHandlers.invite_revoked({ session_id: "one" }));
  expect(result.current.invites).toEqual([parseInvite({ ...raw, session_id: "two" })]);
});
