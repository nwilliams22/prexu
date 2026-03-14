/**
 * Plex server activity API — fetch running activities (scans, metadata
 * updates) and active playback sessions, plus WebSocket notification types.
 */

import { serverFetch } from "./plex-api";
import { logger } from "./logger";

// ── Types ──

export interface PlexActivity {
  uuid: string;
  type: string;
  cancellable: boolean;
  userID: number;
  title: string;
  subtitle: string;
  progress: number;
}

export interface PlexSessionUser {
  id: number;
  title: string;
  thumb: string;
}

export interface PlexSessionPlayer {
  platform: string;
  state: string;
  title: string;
  product: string;
}

export interface PlexSession {
  ratingKey: string;
  type: string;
  title: string;
  grandparentTitle?: string;
  parentTitle?: string;
  thumb: string;
  grandparentThumb?: string;
  User: PlexSessionUser;
  Player: PlexSessionPlayer;
  duration?: number;
  viewOffset?: number;
}

// ── WebSocket notification types ──

export interface PlexActivityNotification {
  event: "started" | "updated" | "ended";
  uuid: string;
  Activity: PlexActivity;
}

export interface PlexNotificationContainer {
  type: string;
  size: number;
  ActivityNotification?: PlexActivityNotification[];
  PlaySessionStateNotification?: unknown[];
  TimelineEntry?: unknown[];
}

// ── Helpers ──

/** Normalise a Plex response value to an array (Plex returns a single
 *  object instead of a one-element array for some endpoints). */
export function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value != null && typeof value === "object") return [value as T];
  return [];
}

/** Build the WebSocket URL for Plex server real-time notifications. */
export function getNotificationUrl(
  serverUri: string,
  serverToken: string,
): string {
  const wsUri = serverUri
    .replace(/^https:/, "wss:")
    .replace(/^http:/, "ws:");
  return `${wsUri}/:/websockets/notifications?X-Plex-Token=${encodeURIComponent(serverToken)}`;
}

// ── REST API ──

/** Fetch current server activities (scans, metadata refreshes, etc.) */
export async function getActivities(
  serverUri: string,
  serverToken: string,
): Promise<PlexActivity[]> {
  try {
    const response = await serverFetch(serverUri, serverToken, "/activities");
    if (!response.ok) {
      logger.warn("activity", `/activities returned ${response.status}`);
      return [];
    }
    const data = await response.json();
    return toArray<PlexActivity>(data?.MediaContainer?.Activity);
  } catch (err) {
    logger.warn("activity", "/activities fetch failed", err);
    return [];
  }
}

/** Fetch active playback sessions */
export async function getActiveSessions(
  serverUri: string,
  serverToken: string,
): Promise<PlexSession[]> {
  try {
    const response = await serverFetch(serverUri, serverToken, "/status/sessions");
    if (!response.ok) {
      logger.warn("activity", `/status/sessions returned ${response.status}`);
      return [];
    }
    const data = await response.json();
    return toArray<PlexSession>(data?.MediaContainer?.Metadata);
  } catch (err) {
    logger.warn("activity", "/status/sessions fetch failed", err);
    return [];
  }
}
