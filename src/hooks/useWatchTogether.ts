/**
 * Watch Together — public API surface.
 * Re-exports the orchestrator from the watch-together/ sub-directory
 * so existing imports continue to work unchanged.
 */

import type { WatchParticipant, WatchLobbySnapshot } from "../types/watch-together";

export interface UseWatchTogetherResult {
  // Session state
  isInSession: boolean;
  lobby: WatchLobbySnapshot | null;
  sessionError: string | null;
  sessionEnded: boolean;
  startNow: () => void;
  resendInvite: (username: string) => void;
  removeParticipant: (username: string) => void;
  isHost: boolean;
  catchingUp: boolean;
  resyncing?: boolean;
  struggling?: boolean;
  participants: WatchParticipant[];
  syncStatus: "synced" | "syncing" | "disconnected";
  sessionId: string | null;

  // Episode transition
  showNextEpisodePrompt: boolean;
  nextEpisodeInfo: { ratingKey: string; title: string } | null;

  // Sync-aware actions (use these instead of player.togglePlay/seek when in session)
  syncTogglePlay: () => void;
  syncSeek: (time: number) => void;

  // Session control
  leaveSession: () => void;
  loadNextEpisode: (ratingKey: string, title: string, mediaType?: "movie" | "episode") => void;
  dismissNextEpisodePrompt: () => void;
}

export { useWatchTogether } from "./watch-together/useWatchTogether";
