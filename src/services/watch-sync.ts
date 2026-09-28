/**
 * Singleton WebSocket service for Watch Together relay communication.
 * Uses an event-emitter pattern so React hooks can subscribe/unsubscribe.
 */

import { logger } from "./logger";
import type { ContentRequestMessage, ContentRequestResponseMessage } from "../types/content-request";
import type { WatchInvite, WatchParticipant } from "../types/watch-together";

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

export interface InviteReceivedMsg {
  type: "invite_received";
  session_id: string;
  media_title: string;
  media_rating_key: string;
  media_type: string;
  sender_username: string;
  sender_thumb: string;
  sent_at: number;
  relay_url: string;
}

export function parseInvite(raw: InviteReceivedMsg): WatchInvite {
  return {
    sessionId: raw.session_id,
    mediaTitle: raw.media_title,
    mediaRatingKey: raw.media_rating_key,
    mediaType: raw.media_type,
    senderUsername: raw.sender_username,
    senderThumb: raw.sender_thumb,
    sentAt: raw.sent_at,
    relayUrl: raw.relay_url ?? "",
  };
}

interface WireParticipant {
  plex_username: string;
  plex_thumb: string;
  is_host: boolean;
  state: "buffering" | "ready" | "playing" | "paused";
}

export function parseParticipant(raw: WireParticipant): WatchParticipant {
  return {
    plexUsername: raw.plex_username,
    plexThumb: raw.plex_thumb,
    isHost: raw.is_host,
    state: raw.state,
  };
}

export interface SyncEventPayloadMap {
  connected: null;
  disconnected: null;
  auth_ok: { type: "auth_ok"; plex_username: string };
  auth_error: { type: "auth_error"; reason: string };
  session_created: { type: "session_created"; session_id: string };
  session_joined: { type: "session_joined"; session_id: string; participants: WireParticipant[] };
  session_error: { type: "session_error"; reason: string };
  participant_joined: { type: "participant_joined"; participant: WireParticipant };
  participant_left: { type: "participant_left"; plex_username: string };
  session_destroyed: { type: "session_destroyed" };
  invite_received: InviteReceivedMsg;
  pending_invites: { type: "pending_invites"; invites: InviteReceivedMsg[] };
  remote_play: { type: "play"; current_time: number; timestamp: number; from_user: string };
  remote_pause: { type: "pause"; current_time: number; timestamp: number; from_user: string };
  remote_seek: { type: "seek"; current_time: number; timestamp: number; from_user: string };
  remote_buffering: { type: "buffering"; from_user: string };
  remote_ready: { type: "ready"; current_time: number; from_user: string };
  new_media: { type: "new_media"; media_rating_key: string; media_title: string; media_type: string; from_user: string };
  pong: { type: "pong" };
  content_request_received: ContentRequestMessage & Record<string, unknown>;
  content_request_response: ContentRequestResponseMessage & Record<string, unknown>;
  pending_content_requests: { type: "pending_content_requests"; requests: (ContentRequestMessage & Record<string, unknown>)[] };
}

type Listener = (data: unknown) => void;

const WIRE_TO_EVENT: Record<string, SyncEventType> = {
  auth_ok: "auth_ok", auth_error: "auth_error",
  session_created: "session_created", session_joined: "session_joined",
  session_error: "session_error", participant_joined: "participant_joined",
  participant_left: "participant_left", session_destroyed: "session_destroyed",
  invite_received: "invite_received", pending_invites: "pending_invites",
  play: "remote_play", pause: "remote_pause", seek: "remote_seek",
  buffering: "remote_buffering", ready: "remote_ready", new_media: "new_media",
  pong: "pong", content_request: "content_request_received",
  content_request_response: "content_request_response",
  pending_content_requests: "pending_content_requests",
};

class wsService {
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
    const sameUrl = this.url === url;
    this.url = url;
    this.authPayload = { plexToken, plexUsername, plexThumb };
    this.shouldReconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (sameUrl && this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.authenticated = false;
    this.createConnection();
  }

  /** Disconnect from the relay server. Stops auto-reconnect. */
  disconnect(): void {
    const hadSocket = this.ws !== null;
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
    this.discardSocket();
    if (hadSocket) this.emit("disconnected", null);
  }

  /** Send a message to the relay server. Accepts any JSON-serialisable
   *  object (typed message shapes with optional fields included). */
  send(message: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn("watch:sync", "Cannot send — not connected");
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends SyncEventType>(event: K, listener: (data: SyncEventPayloadMap[K]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as Listener);
    return () => {
      this.listeners.get(event)?.delete(listener as Listener);
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

  private discardSocket(): void {
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      old.close();
    }
  }

  private createConnection(): void {
    this.discardSocket();
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      logger.error("watch:sync", "Failed to create WebSocket");
      this.scheduleReconnect();
      return;
    }

    const socket = this.ws;
    socket.onopen = () => {
      if (this.ws !== socket) return;
      logger.info("watch:sync", "Connected to relay");
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

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      this.handleMessage(event.data as string);
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      logger.info("watch:sync", "Disconnected from relay");
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

    socket.onerror = () => {
      if (this.ws !== socket) return;
      logger.error("watch:sync", "WebSocket error");
    };
  }

  private handleMessage(raw: string): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      logger.warn("watch:sync", "Failed to parse message");
      return;
    }

    const type = data.type;
    if (typeof type !== "string") {
      logger.warn("watch:sync", "Message missing type");
      return;
    }
    if (type === "auth_ok") this.authenticated = true;
    if (type === "auth_error") this.authenticated = false;
    const event = WIRE_TO_EVENT[type];
    if (event) this.emit(event, data);
    else logger.warn("watch:sync", "Unknown message type", type);
  }

  private emit(event: SyncEventType, data: unknown): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (err) {
          logger.error("watch:sync", `Error in ${event} listener`, err);
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    logger.info("watch:sync", `Reconnecting in ${this.reconnectDelay / 1000}s`);
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
export const watchSync = new wsService();
