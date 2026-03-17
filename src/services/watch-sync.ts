/**
 * Singleton WebSocket service for Watch Together relay communication.
 * Uses an event-emitter pattern so React hooks can subscribe/unsubscribe.
 */

export type SyncEventType =
  | "connected"
  | "disconnected"
  | "auth_ok"
  | "auth_error"
  | "session_created"
  | "session_joined"
  | "session_error"
  | "participant_joined"
  | "participant_left"
  | "session_destroyed"
  | "invite_received"
  | "pending_invites"
  | "remote_play"
  | "remote_pause"
  | "remote_seek"
  | "remote_buffering"
  | "remote_ready"
  | "new_media"
  | "pong"
  | "content_request_received"
  | "content_request_response"
  | "pending_content_requests";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (data: any) => void;

class WatchSyncService {
  private ws: WebSocket | null = null;
  private url = "";
  private listeners: Map<SyncEventType, Set<Listener>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = false;
  private authenticated = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private authPayload: {
    plexToken: string;
    plexUsername: string;
    plexThumb: string;
  } | null = null;

  /** Connect to the relay server and authenticate. */
  connect(
    url: string,
    plexToken: string,
    plexUsername: string,
    plexThumb: string,
  ): void {
    this.url = url;
    this.authPayload = { plexToken, plexUsername, plexThumb };
    this.shouldReconnect = true;
    this.authenticated = false;
    this.createConnection();
  }

  /** Disconnect from the relay server. Stops auto-reconnect. */
  disconnect(): void {
    this.shouldReconnect = false;
    this.authenticated = false;
    this.authPayload = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Send a message to the relay server. */
  send(message: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[WatchSync] Cannot send — not connected");
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on(event: SyncEventType, listener: Listener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  /** Whether the WebSocket is currently open. */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated;
  }

  /** Whether a connection attempt is in progress. */
  get isConnecting(): boolean {
    return (this.ws?.readyState ?? -1) === WebSocket.CONNECTING;
  }

  // ── Private ──

  private createConnection(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error("[WatchSync] Failed to create WebSocket:", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log("[WatchSync] Connected to relay");
      this.reconnectDelay = 1000; // Reset backoff on success
      this.emit("connected", null);

      // Send auth immediately
      if (this.authPayload) {
        this.send({
          type: "auth",
          plex_token: this.authPayload.plexToken,
          plex_username: this.authPayload.plexUsername,
          plex_thumb: this.authPayload.plexThumb,
        });
      }

      // Start keepalive pings
      this.pingInterval = setInterval(() => {
        this.send({ type: "ping" });
      }, 30000);
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data as string);
    };

    this.ws.onclose = () => {
      console.log("[WatchSync] Disconnected from relay");
      this.authenticated = false;
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      this.emit("disconnected", null);

      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.error("[WatchSync] WebSocket error:", err);
    };
  }

  private handleMessage(raw: string): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      console.warn("[WatchSync] Failed to parse message:", raw);
      return;
    }

    const type = data.type as string;

    switch (type) {
      case "auth_ok":
        this.authenticated = true;
        this.emit("auth_ok", data);
        break;
      case "auth_error":
        this.authenticated = false;
        this.emit("auth_error", data);
        break;
      case "session_created":
        this.emit("session_created", data);
        break;
      case "session_joined":
        this.emit("session_joined", data);
        break;
      case "session_error":
        this.emit("session_error", data);
        break;
      case "participant_joined":
        this.emit("participant_joined", data);
        break;
      case "participant_left":
        this.emit("participant_left", data);
        break;
      case "session_destroyed":
        this.emit("session_destroyed", data);
        break;
      case "invite_received":
        this.emit("invite_received", data);
        break;
      case "pending_invites":
        this.emit("pending_invites", data);
        break;
      case "play":
        this.emit("remote_play", data);
        break;
      case "pause":
        this.emit("remote_pause", data);
        break;
      case "seek":
        this.emit("remote_seek", data);
        break;
      case "buffering":
        this.emit("remote_buffering", data);
        break;
      case "ready":
        this.emit("remote_ready", data);
        break;
      case "new_media":
        this.emit("new_media", data);
        break;
      case "pong":
        this.emit("pong", data);
        break;
      case "content_request":
        this.emit("content_request_received", data);
        break;
      case "content_request_response":
        this.emit("content_request_response", data);
        break;
      case "pending_content_requests":
        this.emit("pending_content_requests", data);
        break;
      default:
        console.warn("[WatchSync] Unknown message type:", type);
    }
  }

  private emit(event: SyncEventType, data: unknown): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (err) {
          console.error(`[WatchSync] Error in ${event} listener:`, err);
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    console.log(
      `[WatchSync] Reconnecting in ${this.reconnectDelay / 1000}s...`
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createConnection();
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }
}

/** Singleton instance */
export const watchSync = new WatchSyncService();
