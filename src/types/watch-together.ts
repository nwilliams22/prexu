export interface WatchParticipant {
  plexUsername: string;
  plexThumb: string;
  isHost: boolean;
  state: "buffering" | "ready" | "playing" | "paused";
}

export interface WatchInvite {
  sessionId: string;
  mediaTitle: string;
  mediaRatingKey: string;
  mediaType: string;
  senderUsername: string;
  senderThumb: string;
  sentAt: number;
  relayUrl: string;
}

export interface WatchSession {
  sessionId: string;
  mediaTitle: string;
  mediaRatingKey: string;
  mediaType: string;
  isHost: boolean;
  participants: WatchParticipant[];
}

/** Protocol v2 roster states are distinct from the player's transport state. */
export type WatchLobbyParticipantState =
  | "invited"
  | "joined-buffering"
  | "ready"
  | "reconnecting";

export interface WatchLobbyParticipant {
  plexUsername: string;
  plexThumb: string;
  isHost: boolean;
  state: WatchLobbyParticipantState;
}

export interface WatchLobbySnapshot {
  sessionId: string;
  mediaTitle: string;
  mediaRatingKey: string;
  mediaType: string;
  phase: "lobby" | "playback";
  hostAway: boolean;
  participants: WatchLobbyParticipant[];
}
