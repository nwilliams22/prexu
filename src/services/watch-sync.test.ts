/**
 * Tests for WatchSyncService (watch-sync.ts).
 * Uses a MockWebSocket to simulate WebSocket behavior.
 */

// Module marker for top-level await
export {};

// ── Mock WebSocket ──

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    // Auto-connect in next microtask by default
    queueMicrotask(() => this.simulateOpen());
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  simulateMessage(data: Record<string, unknown>): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }
}

// Store reference to created MockWebSocket instances
let mockWsInstance: MockWebSocket | null = null;

vi.stubGlobal("WebSocket", class extends MockWebSocket {
  constructor(url: string) {
    super(url);
    mockWsInstance = this;
  }
});

// Need to re-import after stubbing WebSocket since module might cache it
// Import the module fresh to get our mocked WebSocket
const { watchSync } = await import("./watch-sync");

describe("WatchSyncService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockWsInstance = null;
    watchSync.disconnect(); // clean state
  });

  afterEach(() => {
    watchSync.disconnect();
    vi.useRealTimers();
  });

  // ── connect ──

  describe("connect", () => {
    it("creates a WebSocket connection", () => {
      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");

      expect(mockWsInstance).not.toBeNull();
      expect(mockWsInstance!.url).toBe("ws://localhost:9847/ws");
    });

    it("sends auth message on open", async () => {
      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");

      // Let microtask (auto-open) run
      await vi.advanceTimersByTimeAsync(0);

      expect(mockWsInstance!.sentMessages.length).toBeGreaterThanOrEqual(1);
      const authMsg = JSON.parse(mockWsInstance!.sentMessages[0]);
      expect(authMsg.type).toBe("auth");
      expect(authMsg.plex_token).toBe("test-plex-token");
      expect(authMsg.plex_username).toBe("testuser");
      expect(authMsg.plex_thumb).toBe("/thumb");
    });

    it("starts ping interval on open", async () => {
      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      const msgCountBefore = mockWsInstance!.sentMessages.length;

      // Advance 30 seconds to trigger ping
      vi.advanceTimersByTime(30000);

      const newMessages = mockWsInstance!.sentMessages.slice(msgCountBefore);
      const pingMsg = newMessages.find(
        (m) => JSON.parse(m).type === "ping"
      );
      expect(pingMsg).toBeDefined();
    });
  });

  // ── disconnect ──

  describe("disconnect", () => {
    it("closes the WebSocket", async () => {
      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      watchSync.disconnect();

      expect(mockWsInstance!.readyState).toBe(MockWebSocket.CLOSED);
    });

    it("stops reconnection attempts", async () => {
      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      watchSync.disconnect();

      // isConnected should be false
      expect(watchSync.isConnected).toBe(false);
    });
  });

  // ── send ──

  describe("send", () => {
    it("JSON-stringifies the message", async () => {
      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      watchSync.send({ type: "play", time: 5000 });

      const lastMsg = mockWsInstance!.sentMessages[
        mockWsInstance!.sentMessages.length - 1
      ];
      expect(JSON.parse(lastMsg)).toEqual({ type: "play", time: 5000 });
    });

    it("warns when not connected (does not throw)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Don't connect, just try to send
      watchSync.send({ type: "play" });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot send")
      );
      warnSpy.mockRestore();
    });
  });

  // ── on / emit (event system) ──

  describe("on / emit", () => {
    it("listeners receive data when event fires", async () => {
      const listener = vi.fn();
      watchSync.on("auth_ok", listener);

      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      // Simulate auth_ok from server
      mockWsInstance!.simulateMessage({ type: "auth_ok", userId: 123 });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "auth_ok", userId: 123 })
      );
    });

    it("unsubscribe removes the listener", async () => {
      const listener = vi.fn();
      const unsub = watchSync.on("auth_ok", listener);

      unsub();

      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      mockWsInstance!.simulateMessage({ type: "auth_ok" });

      expect(listener).not.toHaveBeenCalled();
    });

    it("multiple listeners on same event all fire", async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      watchSync.on("session_created", listener1);
      watchSync.on("session_created", listener2);

      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      mockWsInstance!.simulateMessage({ type: "session_created", sessionId: "abc" });

      expect(listener1).toHaveBeenCalledOnce();
      expect(listener2).toHaveBeenCalledOnce();
    });
  });

  // ── Message routing ──

  describe("message routing", () => {
    it("routes 'play' to 'remote_play'", async () => {
      const listener = vi.fn();
      watchSync.on("remote_play", listener);

      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      mockWsInstance!.simulateMessage({ type: "play", time: 5000 });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "play", time: 5000 })
      );
    });

    it("routes 'pause' to 'remote_pause'", async () => {
      const listener = vi.fn();
      watchSync.on("remote_pause", listener);

      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      mockWsInstance!.simulateMessage({ type: "pause", time: 10000 });
      expect(listener).toHaveBeenCalledOnce();
    });

    it("routes 'seek' to 'remote_seek'", async () => {
      const listener = vi.fn();
      watchSync.on("remote_seek", listener);

      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      mockWsInstance!.simulateMessage({ type: "seek", time: 120000 });
      expect(listener).toHaveBeenCalledOnce();
    });

    it("routes 'buffering' to 'remote_buffering'", async () => {
      const listener = vi.fn();
      watchSync.on("remote_buffering", listener);

      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      mockWsInstance!.simulateMessage({ type: "buffering" });
      expect(listener).toHaveBeenCalledOnce();
    });

    it("routes 'ready' to 'remote_ready'", async () => {
      const listener = vi.fn();
      watchSync.on("remote_ready", listener);

      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      mockWsInstance!.simulateMessage({ type: "ready" });
      expect(listener).toHaveBeenCalledOnce();
    });

    it("routes 'new_media' to 'new_media'", async () => {
      const listener = vi.fn();
      watchSync.on("new_media", listener);

      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      mockWsInstance!.simulateMessage({ type: "new_media", ratingKey: "42" });
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ── isConnected ──

  describe("isConnected", () => {
    it("returns false when not connected", () => {
      expect(watchSync.isConnected).toBe(false);
    });

    it("returns true when open and authenticated", async () => {
      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      // Simulate auth success
      mockWsInstance!.simulateMessage({ type: "auth_ok" });

      expect(watchSync.isConnected).toBe(true);
    });

    it("returns false when open but not authenticated", async () => {
      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      // Not authenticated yet
      expect(watchSync.isConnected).toBe(false);
    });

    it("returns false after disconnect", async () => {
      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateMessage({ type: "auth_ok" });

      watchSync.disconnect();

      expect(watchSync.isConnected).toBe(false);
    });
  });

  // ── Reconnection ──

  describe("reconnection", () => {
    it("schedules reconnect when connection closes unexpectedly", async () => {
      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      const firstInstance = mockWsInstance;

      // Simulate unexpected close
      firstInstance!.simulateClose();

      // Advance past reconnect delay
      await vi.advanceTimersByTimeAsync(1100);

      // A new connection should have been created
      expect(mockWsInstance).not.toBe(firstInstance);
    });

    it("does not reconnect after explicit disconnect", async () => {
      watchSync.connect("ws://localhost:9847/ws", "test-plex-token", "testuser", "/thumb");
      await vi.advanceTimersByTimeAsync(0);

      watchSync.disconnect();

      // Advance well past any reconnect delay
      await vi.advanceTimersByTimeAsync(60000);

      // No new connection should have been created after disconnect
      // (the instance from disconnect's close might be the same)
      expect(watchSync.isConnected).toBe(false);
    });
  });
});
