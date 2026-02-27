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
